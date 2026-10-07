/**
 * The lobby on screen: the header, the name prompt, the chat and the buttons.
 *
 * The town itself is a canvas (pixel/LobbyView). This file opens it, hands it your miner and
 * the other players, and turns what it reports into app actions: walking through the island
 * door switches to the island, the cave door opens Cave Run, the market door opens the Market.
 * It also holds the "back to lobby" pills the other screens use.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, levelFromXp } from '../game/constants';
import { useCave } from '../game/caveStore';
import { joinLobby, leaveLobby, LOBBY_EMOTES, publishLobbyMe, useLobby } from '../game/lobby';
import { cleanName, LOBBY_CAP, type DoorId } from '../game/lobbyMap';
import { isOnChain, useGame, useLevelXp } from '../game/store';
import { play } from '../game/sfx';
import { useName } from '../game/username';
import type { LobbyEvent, LobbyPeerView, LobbySnap } from '../engine/lobby';
import { atlasSource } from '../pixel/atlasSource';
import LobbyView, { type LobbyRef } from '../pixel/LobbyView';
import { myLook } from '../pixel/PixelMine';
import { useView } from '../pixel/view';
import { Btn, Card, T } from './kit';
import { BAR_H } from './TabBar';

const DOOR_UI: { id: DoorId; label: string; color: string }[] = [
  { id: 'island', label: 'ISLAND', color: '#3de0c8' },
  { id: 'cave', label: 'CAVE', color: '#ff9a3d' },
  { id: 'market', label: 'MARKET', color: '#b86bff' },
];

/** The spot a Cave Run from the lobby opens under: the one you are mining, else one you picked. */
function homeSpot(): number {
  const g = useGame.getState();
  if (g.pending) for (let i = 0; i < 25; i++) if (g.pending.mask & (1 << i)) return i;
  return g.selected[0] ?? useCave.getState().spot;
}

export function LobbyScreen({ onMarket }: { onMarket: () => void }) {
  const insets = useSafeAreaInsets();
  const where = useLobby((s) => s.where);
  if (where !== 'lobby') return null;
  return <LobbyInner onMarket={onMarket} top={insets.top} bottomInset={insets.bottom} />;
}

function LobbyInner({ onMarket, top, bottomInset }: { onMarket: () => void; top: number; bottomInset: number }) {
  const ref = useRef<LobbyRef>(null);
  const [atlas, setAtlas] = useState<string | null>(null);
  const spawn = useRef(useLobby.getState().spawn).current;
  const name = useName((s) => s.name);
  const nameReady = useName((s) => s.ready);
  const [editing, setEditing] = useState(false);
  const status = useLobby((s) => s.status);
  const count = useLobby((s) => Object.keys(s.peers).length + 1);
  const msgs = useLobby((s) => s.msgs);
  const lvl = levelFromXp(useLevelXp());
  const sol = useGame((s) => (isOnChain(s) ? s.wallet.sol + s.wallet.sessionSol : s.save.practiceSol));
  const [draft, setDraft] = useState('');
  const look = useRef(myLook()).current;
  const lvlRef = useRef(lvl);
  lvlRef.current = lvl;

  useEffect(() => {
    atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
  }, []);

  // join the room while the lobby is on screen; leave it when you go to the island
  useEffect(() => {
    joinLobby();
    return () => leaveLobby();
  }, []);

  // push the crowd to the canvas ten times a second, only when something changed
  useEffect(() => {
    let sent = '';
    const id = setInterval(() => {
      const s = useLobby.getState();
      const now = Date.now();
      const peers: LobbyPeerView[] = Object.values(s.peers).map((p) => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x),
        y: Math.round(p.y),
        tx: Math.round(p.tx),
        ty: Math.round(p.ty),
        f: p.facing,
        p: p.pose,
        look: p.look,
        say: p.say && now - p.say.at < 6000 ? p.say.t : null,
        emoji: p.emoji && now - p.emojiAt < 3000 ? p.emoji : null,
      }));
      const snap: LobbySnap = {
        peers,
        say: s.mySay && now - s.mySay.at < 6000 ? s.mySay.t : null,
        emoji: s.myEmoji && now - s.myEmoji.at < 3000 ? s.myEmoji.e : null,
      };
      const json = JSON.stringify(snap);
      // On Android the ref's methods only exist once the WebView has loaded.
      const push = ref.current?.push;
      if (json !== sent && typeof push === 'function') {
        sent = json;
        push(snap);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const bottom = bottomInset + 190;
  const topH = top + 88;
  useEffect(() => {
    const f = ref.current?.opts;
    if (typeof f === 'function') f({ top: topH, bottom });
  }, [topH, bottom]);

  const onEvent = useCallback((e: LobbyEvent) => {
    switch (e.t) {
      case 'me':
        publishLobbyMe({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, facing: e.facing, pose: e.pose, look, lvl: lvlRef.current });
        break;
      case 'sfx':
        if (e.name === 'door') play('select');
        break;
      case 'door':
        if (e.id === 'island') useLobby.getState().go('island', 'island');
        else if (e.id === 'cave') useCave.getState().show(homeSpot());
        else onMarket();
        break;
      default:
        break;
    }
  }, [look, onMarket]);

  const send = () => {
    if (!draft.trim()) return;
    if (useLobby.getState().say(draft)) setDraft('');
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      {atlas ? (
        <LobbyView
          ref={ref}
          onEvent={onEvent}
          atlas={atlas}
          look={look}
          opts={{ spawn, top: topH, bottom }}
          dom={{ style: { flex: 1, backgroundColor: '#2f7fc4' }, scrollEnabled: false, bounces: false, overScrollMode: 'never' } as never}
        />
      ) : null}

      {/* header */}
      <View style={[styles.head, { paddingTop: top + 6 }]} pointerEvents="box-none">
        <View style={styles.headRow} pointerEvents="box-none">
          <View style={styles.titleBox}>
            <Image source={require('../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
            <T v="display" style={{ fontSize: 13, color: COLORS.gold, letterSpacing: 1 }}>
              LOBBY
            </T>
          </View>
          <Pressable onPress={() => setEditing(true)} style={styles.chip} accessibilityRole="button" accessibilityLabel="Change your name">
            <View style={[styles.dot, { backgroundColor: status === 'online' ? '#7be07b' : status === 'full' ? COLORS.red : '#ffb347' }]} />
            <T v="bold" style={{ fontSize: 13 }} numberOfLines={1}>
              {name || 'Pick a name'}
            </T>
            <T v="muted" style={{ fontSize: 11 }}>
              Lv {lvl}
            </T>
          </Pressable>
        </View>
        <View style={styles.headRow} pointerEvents="box-none">
          <View style={styles.chip}>
            <T v="black" style={{ color: COLORS.sol, fontSize: 13 }}>
              ◎
            </T>
            <T v="display" style={{ fontSize: 13 }}>
              {sol.toFixed(sol >= 100 ? 1 : 3)}
            </T>
            <T v="muted" style={{ fontSize: 11 }}>
              SOL
            </T>
          </View>
          <View style={styles.chip}>
            <T v="bold" style={{ fontSize: 12 }}>
              {status === 'full' ? 'Lobby full' : status === 'online' ? `${count} here` : status === 'joining' ? 'Joining…' : 'Offline'}
            </T>
          </View>
        </View>
      </View>

      {/* bottom: doors, emotes, chat */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomWrap} pointerEvents="box-none">
        <View style={[styles.bottom, { paddingBottom: bottomInset + 8 }]} pointerEvents="box-none">
          {status === 'full' ? (
            <View style={styles.full}>
              <T v="bold" style={{ fontSize: 12, textAlign: 'center' }}>
                The lobby holds {LOBBY_CAP} players and is full. You can still walk in, but nobody will see you until someone leaves. The island is open.
              </T>
            </View>
          ) : null}
          <View style={styles.log} pointerEvents="none">
            {msgs.slice(-4).map((m) => (
              <View key={m.id} style={styles.line}>
                <T v="black" style={{ fontSize: 12, color: m.mine ? COLORS.gold : COLORS.teal }}>
                  {m.name}
                </T>
                <T v="body" style={{ fontSize: 12, flex: 1 }} numberOfLines={2}>
                  {m.text}
                </T>
              </View>
            ))}
          </View>
          <View style={styles.doors}>
            {DOOR_UI.map((d) => (
              <Pressable key={d.id} onPress={() => ref.current?.goTo?.(d.id)} style={[styles.door, { borderColor: d.color }]} accessibilityRole="button" accessibilityLabel={`Walk to ${d.label}`}>
                <T v="display" style={{ fontSize: 14, color: d.color, letterSpacing: 0.5 }}>
                  {d.label}
                </T>
              </Pressable>
            ))}
          </View>
          <View style={styles.emotes}>
            {LOBBY_EMOTES.map((e) => (
              <Pressable key={e} onPress={() => useLobby.getState().emote(e)} style={styles.emote} accessibilityRole="button" accessibilityLabel={`Emote ${e}`}>
                <T style={{ fontSize: 18 }}>{e}</T>
              </Pressable>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={send}
              placeholder={name ? 'Say something to the lobby…' : 'Pick a name to chat'}
              placeholderTextColor={COLORS.muted}
              editable={Boolean(name)}
              maxLength={80}
              returnKeyType="send"
              style={styles.input}
            />
            <Pressable onPress={send} style={styles.sendBtn} accessibilityRole="button" accessibilityLabel="Send">
              <T v="display" style={{ fontSize: 15, color: '#3a1800' }}>
                SEND
              </T>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {nameReady && (!name || editing) ? <NamePrompt first={!name} onDone={() => setEditing(false)} /> : null}
    </View>
  );
}

function NamePrompt({ first, onDone }: { first: boolean; onDone: () => void }) {
  const [v, setV] = useState(useName.getState().name);
  const [err, setErr] = useState('');
  const save = () => {
    if (!cleanName(v)) {
      setErr('Use 2 to 14 letters, numbers, spaces, dots, dashes or underscores.');
      return;
    }
    useName.getState().set(v);
    onDone();
  };
  return (
    <View style={styles.promptScrim}>
      <Card glow={COLORS.gold} style={{ width: '88%', maxWidth: 380, gap: 10 }}>
        <T v="display" style={{ fontSize: 26, textAlign: 'center' }}>
          {first ? 'Welcome to the lobby' : 'Change your name'}
        </T>
        <T v="muted" style={{ textAlign: 'center' }}>
          Pick the name other miners will see. It is only a label: it does not touch your wallet.
        </T>
        <TextInput
          value={v}
          onChangeText={(t) => {
            setV(t);
            setErr('');
          }}
          onSubmitEditing={save}
          placeholder="Your name"
          placeholderTextColor={COLORS.muted}
          maxLength={14}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { flex: 0, height: 46, minHeight: 46, width: '100%', fontSize: 18, textAlign: 'center' }]}
        />
        {err ? (
          <T v="bold" style={{ color: COLORS.red, fontSize: 12, textAlign: 'center' }}>
            {err}
          </T>
        ) : null}
        <Btn kind="gold" label={first ? 'ENTER THE LOBBY' : 'SAVE NAME'} onPress={save} />
        {!first ? <Btn kind="ghost" small label="Cancel" onPress={onDone} /> : null}
      </Card>
    </View>
  );
}

/** "Back to lobby" on the island. Hidden while a panel has the screen. */
export function LobbyBack() {
  const insets = useSafeAreaInsets();
  const dockOpen = useGame((s) => s.dockOpen);
  const inside = useView((s) => s.focus >= 0);
  const where = useLobby((s) => s.where);
  if (where !== 'island' || dockOpen || inside) return null;
  return (
    <View style={[styles.backWrap, { bottom: insets.bottom + BAR_H + 46 }]} pointerEvents="box-none">
      <BackPill />
    </View>
  );
}

/** The pill itself, for any screen: closes what is open and puts you back in the lobby, at the door you came out of. */
export function BackPill({ door = 'island', onBefore }: { door?: DoorId; onBefore?: () => void }) {
  return (
    <Pressable
      onPress={() => {
        onBefore?.();
        useLobby.getState().go('lobby', door);
      }}
      style={({ pressed }) => [styles.back, pressed && { transform: [{ scale: 0.94 }] }]}
      accessibilityRole="button"
      accessibilityLabel="Back to lobby"
    >
      <T v="display" style={{ fontSize: 16, color: COLORS.gold }}>
        ←
      </T>
      <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
        LOBBY
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#2f7fc4', zIndex: 30 },
  head: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, gap: 6 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 96, height: 30 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 11, borderRadius: 17, backgroundColor: '#070d20e6', borderWidth: 1.5, borderColor: COLORS.gold2, maxWidth: 220 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottom: { paddingHorizontal: 12, gap: 6 },
  full: { backgroundColor: '#070d20ee', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: COLORS.red },
  log: { minHeight: 8, gap: 2 },
  line: { flexDirection: 'row', gap: 6, backgroundColor: '#070d20b3', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  doors: { flexDirection: 'row', gap: 8 },
  door: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070d20e6', borderWidth: 2 },
  emotes: { flexDirection: 'row', justifyContent: 'space-between' },
  emote: { width: 46, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070d20cc', borderWidth: 1, borderColor: '#2f5499' },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, height: 40, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#0c1634', color: COLORS.text, borderWidth: 1.5, borderColor: '#2f5499', fontSize: 14 },
  sendBtn: { height: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  promptScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#070d20cc', alignItems: 'center', justifyContent: 'center' },
  backWrap: { position: 'absolute', left: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: '#070d20e6', borderWidth: 1.5, borderColor: COLORS.gold2 },
});
