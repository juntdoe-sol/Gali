/**
 * Messages: the inbox button (in every top bar) and the messages window. Tap a player anywhere (lobby,
 * island, arena) to open a conversation with them; send tokens from inside it.
 *
 * The rules live in game/dm.ts. The window is its own Modal so it sits over the arena too.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { short, TIP_LIMITS, TIP_SKR_MINT, type TipToken } from '../chain/light';
import { COLORS } from '../game/constants';
import { backToInbox, closeDm, dmReady, openDm, sendDm, sendTokens, setBlocked, signIn, startDm, useDm, type DmMsg, type DmThread } from '../game/dm';
import { useGame } from '../game/store';
import { Btn, Choice, Frame, IconBtn, INPUT, PixelBox, T, Tip, U } from './kit';
import { PixIcon } from './PixIcon';

/** The envelope in the top bar, with the number of unread messages. Nothing without a wallet. */
export function InboxBtn() {
  const owner = useGame((s) => s.wallet.owner);
  const unread = useDm((s) => s.unread);
  useEffect(() => startDm(), []);
  if (!owner || !dmReady()) return null;
  return (
    <Tip text="Messages" side="bottom" width={120}>
      <IconBtn onPress={() => openDm()} label={unread ? `Messages, ${unread} unread` : 'Messages'}>
        <View>
          <PixIcon name="mail" size={20} />
          {unread ? (
            <View style={styles.badge} pointerEvents="none">
              <T v="display" style={{ fontSize: 11, lineHeight: 12, color: '#070d20' }}>
                {unread > 9 ? '9+' : unread}
              </T>
            </View>
          ) : null}
        </View>
      </IconBtn>
    </Tip>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** The messages window. Mounted once at the root. */
export function DmSheet() {
  const insets = useSafeAreaInsets();
  const open = useDm((s) => s.open);
  const pass = useDm((s) => s.pass);
  const withWallet = useDm((s) => s.withWallet);
  if (!open) return null;
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => (withWallet ? backToInbox() : closeDm())}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={closeDm} accessibilityLabel="Close messages" />
        <View style={[styles.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
          <Frame style={styles.win}>{!pass ? <SignIn /> : withWallet ? <Thread /> : <Inbox />}</Frame>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Head({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) {
  return (
    <View style={styles.head}>
      {onBack ? (
        <IconBtn onPress={onBack} label="Back to messages">
          <PixIcon name="back" size={18} />
        </IconBtn>
      ) : (
        <PixIcon name="mail" size={26} />
      )}
      <View style={{ flex: 1 }}>
        <T v="display" numberOfLines={1} style={{ fontSize: 22, lineHeight: 24, letterSpacing: 1 }}>
          {title}
        </T>
        {sub ? (
          <T v="muted" numberOfLines={1} style={{ fontSize: 12 }}>
            {sub}
          </T>
        ) : null}
      </View>
      <IconBtn onPress={closeDm} label="Close messages" kbd="ESC">
        <PixIcon name="close" size={18} />
      </IconBtn>
    </View>
  );
}

function Err() {
  const error = useDm((s) => s.error);
  if (!error) return null;
  return (
    <T v="bold" style={{ color: COLORS.red, fontSize: 12 }}>
      {error}
    </T>
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signIn();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      useDm.setState({ error: /declined|cancel|rejected/i.test(m) ? 'Cancelled in wallet' : m.slice(0, 160) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Head title="MESSAGES" sub="Private, wallet to wallet" />
      <View style={{ gap: 10, paddingVertical: 10 }}>
        <PixIcon name="wallet" size={48} style={{ alignSelf: 'center' }} />
        <T style={{ textAlign: 'center' }}>Sign in once with your wallet to read and send messages. Only you and the other player can read a conversation.</T>
        <T v="muted" style={{ textAlign: 'center', fontSize: 12 }}>
          Your wallet signs a short text. It costs nothing and sends no transaction. Messages are kept for 30 days.
        </T>
        <Btn kind="gold" label={busy ? 'CHECK YOUR WALLET' : 'SIGN IN WITH WALLET'} disabled={busy} onPress={go} />
        <Err />
      </View>
    </>
  );
}

function Inbox() {
  const threads = useDm((s) => s.threads);
  return (
    <>
      <Head title="MESSAGES" sub="Tap a player in the lobby, island or arena to message them" />
      <FlatList
        data={threads}
        keyExtractor={(t) => t.wallet}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 6, paddingVertical: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <PixIcon name="chat" size={48} />
            <T v="bold" style={{ textAlign: 'center' }}>
              No messages yet.
            </T>
            <T v="muted" style={{ textAlign: 'center', fontSize: 12 }}>
              Tap another miner in the lobby, on the island or in the arena.
            </T>
          </View>
        }
        renderItem={({ item }) => <ThreadRow t={item} />}
      />
      <Err />
    </>
  );
}

function ThreadRow({ t }: { t: DmThread }) {
  return (
    <Pressable onPress={() => openDm(t.wallet, t.name)} accessibilityRole="button" accessibilityLabel={`Open messages with ${t.name || short(t.wallet)}`}>
      {(st) => (
        <PixelBox fill={(st as { hovered?: boolean }).hovered ? '#1a2a5a' : 'rgba(14,24,56,0.95)'} hi={t.unread ? COLORS.gold : '#2d4282'} lo="#04060f" style={styles.row}>
          <PixIcon name={t.kind === 'tip' ? 'gift' : 'user'} size={26} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T v="black" numberOfLines={1} style={{ flexShrink: 1, color: COLORS.gold }}>
                {t.name || short(t.wallet)}
              </T>
              <T v="muted" style={{ fontSize: 11 }}>
                {when(t.at)}
              </T>
            </View>
            <T v={t.unread ? 'bold' : 'muted'} numberOfLines={1} style={{ fontSize: 13 }}>
              {t.mine ? 'You: ' : ''}
              {t.last}
            </T>
          </View>
          {t.unread ? (
            <View style={styles.dotBadge}>
              <T v="display" style={{ fontSize: 12, lineHeight: 13, color: '#070d20' }}>
                {t.unread}
              </T>
            </View>
          ) : null}
        </PixelBox>
      )}
    </Pressable>
  );
}

function Thread() {
  const me = useDm((s) => s.me);
  const withWallet = useDm((s) => s.withWallet) as string;
  const withName = useDm((s) => s.withName);
  const msgs = useDm((s) => s.msgs);
  const blocked = useDm((s) => s.blocked);
  const [text, setText] = useState('');
  const [tokens, setTokens] = useState(false);
  const list = useRef<FlatList<DmMsg>>(null);
  useEffect(() => {
    setTimeout(() => list.current?.scrollToEnd({ animated: false }), 60);
  }, [msgs.length]);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    if (!(await sendDm(t))) setText(t);
  };
  return (
    <>
      <Head title={(withName || short(withWallet)).toUpperCase()} sub={`Wallet ${short(withWallet)}. A player can claim any name: check the wallet.`} onBack={backToInbox} />
      <FlatList
        ref={list}
        data={msgs}
        keyExtractor={(m) => String(m.id)}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <T v="muted" style={{ textAlign: 'center' }}>
              Say hi. Only the two of you can read this.
            </T>
          </View>
        }
        renderItem={({ item: m }) => <Bubble m={m} mine={m.sender === me} />}
      />
      {tokens ? <TokenPicker onDone={() => setTokens(false)} /> : null}
      <View style={styles.inputRow}>
        <IconBtn onPress={() => setTokens((v) => !v)} label="Send tokens" active={tokens}>
          <PixIcon name="gift" size={22} />
        </IconBtn>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          placeholder="Message"
          placeholderTextColor={COLORS.muted}
          maxLength={280}
          returnKeyType="send"
          style={[INPUT, { flex: 1 }]}
        />
        <Btn kind="gold" small label="Send" disabled={!text.trim()} onPress={send} />
      </View>
      <Err />
      <Pressable onPress={() => void setBlocked(!blocked)} accessibilityRole="button" style={{ alignSelf: 'center', padding: 4 }}>
        <T v="muted" style={{ fontSize: 11, textDecorationLine: 'underline' }}>
          {blocked ? 'Unblock this player' : 'Block this player'}
        </T>
      </Pressable>
    </>
  );
}

function Bubble({ m, mine }: { m: DmMsg; mine: boolean }) {
  const tip = m.kind === 'tip';
  return (
    <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
      <PixelBox
        fill={tip ? '#123a2a' : mine ? COLORS.gold : 'rgba(14,24,56,0.95)'}
        hi={tip ? COLORS.green : mine ? '#fff1a6' : '#2d4282'}
        lo={mine && !tip ? '#d27a12' : '#04060f'}
        edge={mine && !tip ? '#2a1400' : '#04060f'}
        style={[styles.bubble, m.local && { opacity: 0.6 }]}
      >
        {tip ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PixIcon name={m.tip_token === 'SOL' ? 'sol' : m.tip_token === 'SKR' ? 'skr' : 'ore'} size={22} />
            <T v="black" style={{ color: COLORS.green }}>
              {mine ? `You sent ${m.tip_amount} ${m.tip_token}` : `Sent you ${m.tip_amount} ${m.tip_token}`}
            </T>
          </View>
        ) : (
          <T style={{ color: mine ? '#2b1600' : COLORS.text }}>{m.body}</T>
        )}
        <T v="muted" style={{ fontSize: 11, alignSelf: 'flex-end', color: mine && !tip ? '#6b3a00' : COLORS.muted }}>
          {m.local ? 'Sending' : when(m.at)}
          {mine && !m.local && m.read_at ? ' · Seen' : ''}
        </T>
      </PixelBox>
    </View>
  );
}

/** Pick a token and an amount, then approve it in your wallet. Same amounts as a lobby tip. */
function TokenPicker({ onDone }: { onDone: () => void }) {
  const sol = useGame((s) => s.wallet.sol);
  const ore = useGame((s) => s.wallet.ore);
  const busy = useDm((s) => s.busy);
  const list: TipToken[] = TIP_SKR_MINT ? ['ORE', 'SKR', 'SOL'] : ['ORE', 'SOL'];
  const [token, setToken] = useState<TipToken>('ORE');
  const [amount, setAmount] = useState<number>(TIP_LIMITS.ORE[1]);
  const FEE = 0.003;
  const short_ = token === 'SOL' ? sol < amount + FEE : token === 'ORE' ? ore < amount || sol < FEE : sol < FEE;
  const go = async () => {
    if (busy) return;
    if (short_) {
      useDm.setState({ error: token === 'SOL' ? `Not enough SOL (you have ${sol.toFixed(4)})` : token === 'ORE' && ore < amount ? `Not enough ORE (you have ${ore.toFixed(4)})` : 'Keep about 0.003 SOL for the network fee' });
      return;
    }
    if (await sendTokens(token, amount)) onDone();
  };
  return (
    <PixelBox fill="rgba(8,13,32,0.96)" hi={COLORS.gold} lo="#04060f" style={styles.tokens}>
      <View style={styles.tipRow}>
        {list.map((t) => (
          <Choice
            key={t}
            label={t}
            on={token === t}
            onPress={() => {
              setToken(t);
              setAmount(TIP_LIMITS[t][1]);
            }}
            icon={<PixIcon name={t === 'SOL' ? 'sol' : t === 'ORE' ? 'ore' : 'skr'} size={18} />}
          />
        ))}
      </View>
      <View style={styles.tipRow}>
        {TIP_LIMITS[token].map((a) => (
          <Choice key={a} label={String(a)} on={amount === a} onPress={() => setAmount(a)} />
        ))}
      </View>
      <T v="muted" style={{ fontSize: 11, textAlign: 'center' }}>
        You approve it in your wallet. Network fee about 0.0001 SOL{token === 'SOL' ? '.' : `, plus about 0.002 SOL if they have no ${token} account yet.`}
      </T>
      <Btn kind="gold" small label={busy ? 'WAITING FOR WALLET' : `SEND ${amount} ${token}`} disabled={busy} onPress={go} />
    </PixelBox>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(4,6,15,0.6)' },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  win: { width: '100%', maxWidth: 520, height: '100%', maxHeight: 640, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: U, borderColor: '#22356f' },
  empty: { alignItems: 'center', gap: 8, padding: 30 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  dotBadge: { minWidth: 22, height: 22, paddingHorizontal: 4, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -8, top: -6, minWidth: 16, height: 16, paddingHorizontal: 2, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', paddingHorizontal: 12, paddingVertical: 7 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tokens: { padding: 10, gap: 8 },
  tipRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
});
