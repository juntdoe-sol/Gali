/**
 * Approving a TV run from a phone (TV Stage 2; EXPO_PUBLIC_TV_PAIR=0 turns it off).
 *
 * The TV's QR is a gali://tv link, so the Seeker's camera opens this sheet in Gali; SCAN TV takes the typed code instead.
 *
 * Approve = one wallet approval that funds an all-spots ORE autopilot and tops up the TV's fee key
 * (store.startTvAutopilot). The phone then tells the TV its address; the TV checks the chain before it pairs.
 */
import { PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { create } from 'zustand';
import { short } from '../chain/light';
import { COLORS } from '../game/constants';
import { useGame } from '../game/store';
import { cleanCode, openPairChannel, parseTvUrl, perSpotLamports, prettyCode, readRequest, TV_SPOTS, type PairChannel, type PairRequest } from '../tv/link';
import { Btn, Scrim, T, Window } from './kit';

/** On in every build from 1.6.5; EXPO_PUBLIC_TV_PAIR=0 builds a phone app without it. */
export const TV_PAIR = process.env.EXPO_PUBLIC_TV_PAIR !== '0';

type Phase = 'idle' | 'enter' | 'lookup' | 'approve' | 'sending' | 'done' | 'failed' | 'stop' | 'stopped';

interface TvLinkState {
  phase: Phase;
  req: PairRequest | null;
  /** the run's owner, for a stop link */
  stopOwner: string | null;
  error: string | null;
}

export const useTvLink = create<TvLinkState>(() => ({ phase: 'idle', req: null, stopOwner: null, error: null }));
const setLink = (p: Partial<TvLinkState>) => useTvLink.setState(p);

/** The "Scan TV" entry: the camera does the scanning (the QR is a link), so in the app this is the code box. */
export const openScanTv = () => setLink({ phase: 'enter', req: null, error: null });
const close = () => {
  ch?.close();
  ch = null;
  setLink({ phase: 'idle', req: null, stopOwner: null, error: null });
};

let ch: PairChannel | null = null;

/** Opens whatever a TV link asks for. Returns false for anything that isn't one. */
export function handleTvUrl(url: string | null | undefined): boolean {
  if (!TV_PAIR || !url) return false;
  const link = parseTvUrl(url);
  if (!link) return false;
  if (link.kind === 'stop') setLink({ phase: 'stop', stopOwner: link.owner, req: null, error: null });
  else if (link.kind === 'code') void lookUp(link.code);
  else setLink({ phase: 'approve', req: link, error: null });
  return true;
}

/** A typed code: ask the TV on its channel for the run it wants. */
async function lookUp(code: string) {
  setLink({ phase: 'lookup', req: null, error: null });
  ch?.close();
  let found = false;
  let hello: ReturnType<typeof setInterval> | null = null;
  try {
    ch = await openPairChannel(
      code,
      (event, p) => {
        if (event !== 'req' || found) return;
        const r = readRequest(p);
        if (!r || r.code !== code) return;
        found = true;
        if (hello) clearInterval(hello);
        setLink({ phase: 'approve', req: r });
      },
      () => ch?.send('hello', {}),
    );
    hello = setInterval(() => ch?.send('hello', {}), 2000);
    setTimeout(() => {
      if (hello) clearInterval(hello);
      if (!found && useTvLink.getState().phase === 'lookup')
        setLink({ phase: 'failed', error: `No TV answered code ${prettyCode(code)}. Check the code on the TV (it lasts 5 minutes).` });
    }, 15_000);
  } catch (e) {
    setLink({ phase: 'failed', error: String((e as Error)?.message ?? e) });
  }
}

async function approve(req: PairRequest) {
  const g = useGame.getState();
  if (!g.wallet.owner) return void g.connect();
  if (req.exp < Date.now()) return setLink({ phase: 'failed', error: 'This TV code has expired. Press OK on the TV for a new one.' });
  const perSpot = perSpotLamports(req.lpr) / 1e9;
  const owner = await g.startTvAutopilot(perSpot, req.rounds, new PublicKey(req.tv));
  if (!owner) return; // the store already said why (toast)
  setLink({ phase: 'sending' });
  // Tell the TV who we are until it answers. It checks the chain itself; this only says where to look.
  try {
    const me = owner.toBase58();
    let acked: boolean | null = null;
    ch?.close();
    ch = await openPairChannel(req.code, (event, p) => {
      if (event === 'ack' && p.owner === me) acked = Boolean(p.ok);
    });
    for (let i = 0; i < 30 && acked === null; i++) {
      ch.send('owner', { owner: me });
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (acked) setLink({ phase: 'done' });
    else
      setLink({
        phase: 'failed',
        error: acked === false ? "The TV couldn't confirm the autopilot on chain yet. It keeps running; stop it from the wallet panel if you like." : "The TV didn't answer. Your autopilot is on and runs without the TV; stop it any time from the wallet panel.",
      });
  } catch (e) {
    setLink({ phase: 'failed', error: String((e as Error)?.message ?? e) });
  }
}

async function stop(owner: string) {
  const g = useGame.getState();
  if (!g.wallet.owner) return void g.connect();
  if (g.wallet.owner !== owner) return setLink({ phase: 'failed', error: `This TV run belongs to ${short(owner)}. Connect that wallet to stop it.` });
  await g.stopAutopilot();
  if (!useGame.getState().autopilot) setLink({ phase: 'stopped' });
}

/* ---------------- the sheet ---------------- */

const Line = ({ k, v, gold }: { k: string; v: string; gold?: boolean }) => (
  <View style={styles.line}>
    <T v="muted" style={{ fontSize: 14 }}>
      {k}
    </T>
    <T v="black" style={{ fontSize: 15, color: gold ? COLORS.gold : COLORS.text }}>
      {v}
    </T>
  </View>
);

const sol = (n: number) => Number(n.toPrecision(4)).toString();

function Body() {
  const { phase, req, stopOwner, error } = useTvLink();
  const owner = useGame((s) => s.wallet.owner);
  const busy = useGame((s) => s.wallet.busy);
  const [code, setCode] = useState('');

  if (phase === 'enter')
    return (
      <>
        <T style={{ fontSize: 14, lineHeight: 20 }}>Point your phone camera at the QR on the TV, or type the code shown under it.</T>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(cleanCode(v).slice(0, 6))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="K7Q4-9F"
          placeholderTextColor={COLORS.muted}
          style={styles.input}
        />
        <Btn kind="skr" label="FIND MY TV" disabled={code.length !== 6} onPress={() => void lookUp(code)} />
      </>
    );
  if (phase === 'lookup') return <T style={{ fontSize: 15 }}>Looking for the TV…</T>;
  if (phase === 'approve' && req) {
    const perRound = (perSpotLamports(req.lpr) / 1e9) * TV_SPOTS;
    const expired = req.exp < Date.now();
    return (
      <>
        <T v="muted" style={{ fontSize: 12, letterSpacing: 1 }}>{`TV ${prettyCode(req.code)}`}</T>
        <Line k="Amount" v={`${sol(perRound * req.rounds)} SOL`} gold />
        <Line k="Rounds" v={`${req.rounds} × ${sol(perRound)} SOL`} />
        <Line k="Spots" v="All 25" />
        <Line k="Network fee" v="0.00001 SOL / round" />
        <Line k="TV fee float (once)" v="up to 0.002 SOL" />
        <T v="muted" style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
          {"Your SOL sits in ORE's autopilot, not on the TV. The TV can only press deploy; it can't move your SOL. Stop any time to get the unused SOL back."}
        </T>
        <Btn kind="skr" label={busy ? busy : expired ? 'CODE EXPIRED' : owner ? 'APPROVE' : 'CONNECT WALLET'} disabled={Boolean(busy) || expired} onPress={() => void approve(req)} />
      </>
    );
  }
  if (phase === 'sending') return <T style={{ fontSize: 15 }}>Approved. Telling your TV…</T>;
  if (phase === 'done')
    return (
      <>
        <T v="display" style={{ fontSize: 26, color: COLORS.skr }}>
          PAIRED!
        </T>
        <T style={{ fontSize: 14, lineHeight: 20 }}>Your TV is mining. The autopilot keeps going with the TV off; stop it from the TV (Back) or the wallet panel.</T>
        <Btn label="DONE" onPress={close} />
      </>
    );
  if (phase === 'stop' && stopOwner)
    return (
      <>
        <T style={{ fontSize: 14, lineHeight: 20 }}>Stop the TV autopilot? ORE closes it and sends the unused SOL back to your wallet. One wallet approval.</T>
        <Line k="Run" v={short(stopOwner)} />
        <Btn kind="red" label={busy ? busy : owner ? 'STOP AUTOPILOT' : 'CONNECT WALLET'} disabled={Boolean(busy)} onPress={() => void stop(stopOwner)} />
      </>
    );
  if (phase === 'stopped')
    return (
      <>
        <T style={{ fontSize: 14 }}>Autopilot closed. The unused SOL is back in your wallet.</T>
        <Btn label="DONE" onPress={close} />
      </>
    );
  return (
    <>
      <T style={{ fontSize: 14, lineHeight: 20, color: '#ffb3ab' }}>{error ?? 'Something went wrong.'}</T>
      <Btn label="CLOSE" onPress={close} />
    </>
  );
}

const TITLE: Record<Phase, string> = {
  idle: '',
  enter: 'SCAN TV',
  lookup: 'SCAN TV',
  approve: 'APPROVE TV AUTOPILOT',
  sending: 'APPROVE TV AUTOPILOT',
  done: 'TV PAIRED',
  failed: 'TV PAIRING',
  stop: 'STOP TV AUTOPILOT',
  stopped: 'STOP TV AUTOPILOT',
};

/** Mounted once in the app: listens for TV links and shows the sheet. */
export function TvLinkSheet() {
  const phase = useTvLink((s) => s.phase);
  useEffect(() => {
    if (!TV_PAIR) return;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') handleTvUrl(window.location.href);
      return;
    }
    void Linking.getInitialURL().then(handleTvUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleTvUrl(url));
    return () => sub.remove();
  }, []);
  if (!TV_PAIR || phase === 'idle') return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <Scrim>
        <Window title={TITLE[phase]} onClose={phase === 'sending' ? undefined : close} width={420} accent={COLORS.gold}>
          <Body />
        </Window>
      </Scrim>
    </Modal>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: 'rgba(255,255,255,0.06)' },
  input: {
    height: 56,
    marginVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#060a1c',
    borderWidth: 3,
    borderColor: '#1e2c5c',
    color: COLORS.gold,
    fontFamily: 'Jersey15_400Regular',
    fontSize: 32,
    letterSpacing: 6,
    textAlign: 'center',
  },
});
