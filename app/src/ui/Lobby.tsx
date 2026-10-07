/**
 * The lobby on screen: the header, the name prompt, the chat and the buttons.
 *
 * The town itself is a canvas (pixel/LobbyView). This file opens it, hands it your miner and
 * the other players, and turns what it reports into app actions: walking through the island
 * door switches to the island, the cave door opens Cave Run, the market door opens the Market.
 * It also holds the "back to lobby" pills the other screens use.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, levelFromXp } from '../game/constants';
import { useCave } from '../game/caveStore';
import { joinChat, joinLobby, leaveLobby, LOBBY_EMOTES, publishLobbyMe, useLobby, type LobbyMsg } from '../game/lobby';
import { cleanName, LOBBY_CAP, type DoorId } from '../game/lobbyMap';
import { isOnChain, useGame, useLevelXp } from '../game/store';
import { play } from '../game/sfx';
import { useName } from '../game/username';
import type { LobbyEvent, LobbyPeerView, LobbySnap } from '../engine/lobby';
import { atlasSource } from '../pixel/atlasSource';
import LobbyView, { type LobbyRef } from '../pixel/LobbyView';
import { myLook } from '../pixel/PixelMine';
import { useView } from '../pixel/view';
import { Btn, F, T } from './kit';
import { BAR_H, TabBar, type SheetTab } from './TabBar';

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

export function LobbyScreen({ onMarket, sheet, onTab }: { onMarket: () => void; sheet: SheetTab | null; onTab: (t: SheetTab | null) => void }) {
  const insets = useSafeAreaInsets();
  const where = useLobby((s) => s.where);
  if (where !== 'lobby') return null;
  return <LobbyInner onMarket={onMarket} top={insets.top} bottomInset={insets.bottom} sheet={sheet} onTab={onTab} />;
}

function LobbyInner({ onMarket, top, bottomInset, sheet, onTab }: { onMarket: () => void; top: number; bottomInset: number; sheet: SheetTab | null; onTab: (t: SheetTab | null) => void }) {
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
  const [navOpen, setNavOpen] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const look = useRef(myLook()).current;
  const lvlRef = useRef(lvl);
  lvlRef.current = lvl;

  useEffect(() => {
    atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
  }, []);

  // first visit: show how to play once, after the player has picked a name
  useEffect(() => {
    if (!name) return;
    AsyncStorage.getItem(HOWTO_KEY).then(
      (v) => {
        if (!v) setHowTo(true);
      },
      () => undefined,
    );
  }, [name]);
  const closeHowTo = () => {
    setHowTo(false);
    AsyncStorage.setItem(HOWTO_KEY, '1').catch(() => undefined);
  };

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

  const bottom = bottomInset + BAR_H + 150;
  const topH = top + 88;
  useEffect(() => {
    const f = ref.current?.opts;
    if (typeof f === 'function') f({ top: topH, bottom });
  }, [topH, bottom]);

  /** Go through a door: by walking in, or instantly from the travel menu. */
  const enter = useCallback(
    (id: DoorId) => {
      setNavOpen(false);
      if (id === 'island') useLobby.getState().go('island', 'island');
      else if (id === 'cave') {
        useLobby.setState({ spawn: 'cave' });
        useCave.getState().show(homeSpot());
      } else {
        useLobby.setState({ spawn: 'market' });
        onMarket();
      }
    },
    [onMarket],
  );

  const onEvent = useCallback((e: LobbyEvent) => {
    switch (e.t) {
      case 'me':
        publishLobbyMe({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, facing: e.facing, pose: e.pose, look, lvl: lvlRef.current });
        break;
      case 'sfx':
        if (e.name === 'door') play('select');
        break;
      case 'door':
        enter(e.id);
        break;
      default:
        break;
    }
  }, [look, enter]);

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
          <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable onPress={() => setHowTo(true)} style={styles.chip} accessibilityRole="button" accessibilityLabel="How to play">
            <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
              ?
            </T>
            <T v="bold" style={{ fontSize: 12 }}>
              How to play
            </T>
          </Pressable>
          <View style={styles.chip}>
            <T v="bold" style={{ fontSize: 12 }}>
              {status === 'full' ? 'Lobby full' : status === 'online' ? `${count} here` : status === 'joining' ? 'Joining…' : 'Offline'}
            </T>
          </View>
          </View>
        </View>
      </View>

      {/* bottom: the last few lines, emotes, then the same bar as the island */}
      <View style={[styles.bottom, { bottom: bottomInset + BAR_H + 40 }]} pointerEvents="box-none">
        {status === 'full' ? (
          <View style={styles.full}>
            <T v="bold" style={{ fontSize: 12, textAlign: 'center' }}>
              The lobby holds {LOBBY_CAP} players and is full. You can still walk in, but nobody will see you until someone leaves. The island is open.
            </T>
          </View>
        ) : null}
        <Pressable style={styles.log} onPress={() => useLobby.getState().setChatOpen(true)} accessibilityRole="button" accessibilityLabel="Open the lobby chat">
          {msgs.slice(-3).map((m) => (
            <View key={m.id} style={styles.line}>
              <T v="black" style={{ fontSize: 12, color: m.mine ? COLORS.gold : COLORS.teal }}>
                {m.name}
              </T>
              <T v="body" style={{ fontSize: 12, flex: 1 }} numberOfLines={2}>
                {m.text}
              </T>
            </View>
          ))}
        </Pressable>
        <View style={styles.emotes}>
          {LOBBY_EMOTES.map((e) => (
            <Pressable key={e} onPress={() => useLobby.getState().emote(e)} style={styles.emote} accessibilityRole="button" accessibilityLabel={`Emote ${e}`}>
              <T style={{ fontSize: 18 }}>{e}</T>
            </Pressable>
          ))}
        </View>
      </View>

      {navOpen ? (
        <>
          <Pressable style={styles.navScrim} onPress={() => setNavOpen(false)} accessibilityLabel="Close travel menu" />
          <View style={[styles.nav, { bottom: bottomInset + BAR_H + 84 }]} pointerEvents="box-none">
            {DOOR_UI.map((d) => (
              <Pressable key={d.id} onPress={() => enter(d.id)} style={[styles.navBtn, { borderColor: d.color }]} accessibilityRole="button" accessibilityLabel={`Go to ${d.label}`}>
                <T v="display" style={{ fontSize: 15, color: d.color, letterSpacing: 0.5 }}>
                  {d.label}
                </T>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <TabBar
        active={sheet}
        onTab={(t) => {
          setNavOpen(false);
          onTab(t);
        }}
        lobby={{ navOpen, onNav: () => setNavOpen((v) => !v) }}
      />

      {howTo ? <HowToPlay onClose={closeHowTo} /> : null}

      {nameReady && (!name || editing) ? <NamePrompt first={!name} onDone={() => setEditing(false)} /> : null}
    </View>
  );
}

const HOWTO_KEY = 'gali-lobby-howto-v1';

const HOWTO: { icon: string; title: string; body: string }[] = [
  { icon: '🕹', title: 'Walk around', body: 'Use the joystick, tap or drag on the map, or WASD on a keyboard. Pinch or scroll to zoom. Other players are real people in the lobby right now.' },
  { icon: '💬', title: 'Talk and react', body: 'Pick a name, then use CHAT in the bar to message everyone. Tap an emoji to wave, laugh or show off.' },
  { icon: '🏝', title: 'Island: mine ORE', body: 'Walk onto the jetty, or tap GO then ISLAND. Pick spots on the map, deploy SOL, and win ORE when your spot is the gold one. Your wallet approves every deploy. Only play with SOL you can afford to lose.' },
  { icon: '⛏', title: 'Cave: Cave Run', body: 'Go into the cave for the Cave Run mini game. It earns XP and does not spend SOL.' },
  { icon: '🏪', title: 'Market: gear', body: 'Walk into the shop to see pickaxes, hats and pets for your miner.' },
  { icon: '🤖', title: 'Autopilot', body: 'On the island, open MINE, then PRO and set Rounds above 1. One wallet approval funds ORE automation, and your rounds then deploy by themselves while the app is open. STOP gets the unused SOL back.' },
  { icon: '↩', title: 'Back to the lobby', body: 'Every place has a LOBBY button. The GO button in the bar jumps straight to the island, cave or market.' },
];

/** A short guide for new players, shown once and always one tap away from the lobby header. */
function HowToPlay({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.promptScrim}>
      <View style={[styles.howCard, { maxHeight: '86%', marginTop: insets.top }]}>
        <T v="display" style={{ fontSize: 26, textAlign: 'center' }}>
          How to play
        </T>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
          {HOWTO.map((h) => (
            <View key={h.title} style={styles.howRow}>
              <T style={{ fontSize: 24, width: 34, textAlign: 'center' }}>{h.icon}</T>
              <View style={{ flex: 1 }}>
                <T v="black" style={{ fontSize: 14, color: COLORS.gold }}>
                  {h.title}
                </T>
                <T v="body" style={{ fontSize: 13 }}>
                  {h.body}
                </T>
              </View>
            </View>
          ))}
        </ScrollView>
        <Btn kind="gold" label="GOT IT" onPress={onClose} />
      </View>
    </View>
  );
}

/**
 * The one chat box. The lobby and the island's CHAT tab both open this sheet, and it shows the same room,
 * so a message sent from the island appears in the lobby and the other way round.
 */
export function SharedChat() {
  const insets = useSafeAreaInsets();
  const open = useLobby((s) => s.chatOpen);
  const msgs = useLobby((s) => s.msgs);
  const chatStatus = useLobby((s) => s.chatStatus);
  const name = useName((s) => s.name);
  const [text, setText] = useState('');
  const [draftName, setDraftName] = useState('');
  const [nameErr, setNameErr] = useState('');
  const list = useRef<FlatList<LobbyMsg>>(null);
  useEffect(() => {
    joinChat();
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
  }, [open, msgs.length]);
  if (!open) return null;
  const close = () => useLobby.getState().setChatOpen(false);
  const send = () => {
    if (!text.trim()) return;
    if (useLobby.getState().say(text)) setText('');
  };
  return (
    <Modal transparent visible animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={cs.backdrop} onPress={close} />
        <View style={[cs.sheet, { paddingBottom: insets.bottom + 10 }]}>
          <View style={cs.head}>
            <View>
              <T v="display" style={{ fontSize: 24 }}>
                Miners chat
              </T>
              <T v="muted">{chatStatus === 'online' ? 'Global room · everyone in the lobby and on the island' : chatStatus === 'joining' ? 'Connecting…' : 'Chat server not connected yet'}</T>
            </View>
            <Btn small label="✕" onPress={close} />
          </View>
          <FlatList
            ref={list}
            data={msgs}
            keyExtractor={(m) => String(m.id)}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
            ListEmptyComponent={
              <View style={cs.empty}>
                <T style={{ fontSize: 36 }}>⛏</T>
                <T v="bold" style={{ textAlign: 'center' }}>
                  No messages yet. Say hi to the other miners.
                </T>
              </View>
            }
            renderItem={({ item: m }) => {
              const time = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <View style={[cs.bubbleRow, m.mine && { justifyContent: 'flex-end' }]}>
                  <View style={[cs.bubble, m.mine && cs.bubbleMine]}>
                    {!m.mine ? (
                      <T v="black" style={{ fontSize: 12, color: COLORS.gold, marginBottom: 2 }}>
                        {m.name}
                      </T>
                    ) : null}
                    <T style={{ color: m.mine ? '#2b1600' : COLORS.text }}>{m.text}</T>
                    <T v="muted" style={{ fontSize: 10, alignSelf: 'flex-end', color: m.mine ? '#6b3a00' : COLORS.muted }}>
                      {time}
                    </T>
                  </View>
                </View>
              );
            }}
          />
          <View style={cs.emoteRow}>
            {LOBBY_EMOTES.map((e) => (
              <Pressable key={e} onPress={() => useLobby.getState().emote(e)} style={cs.emote} accessibilityRole="button" accessibilityLabel={`Emote ${e}`}>
                <T style={{ fontSize: 18 }}>{e}</T>
              </Pressable>
            ))}
          </View>
          {name ? (
            <View style={cs.inputRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={send}
                placeholder={chatStatus === 'online' ? 'Message the mine…' : 'Chat is offline'}
                placeholderTextColor={COLORS.muted}
                editable={chatStatus === 'online'}
                maxLength={80}
                returnKeyType="send"
                style={cs.input}
              />
              <Btn kind="gold" small label="Send" disabled={chatStatus !== 'online' || !text.trim()} onPress={send} />
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <T v="muted">Pick a name so other miners know who is talking. It is only a label and does not touch your wallet.</T>
              <View style={cs.inputRow}>
                <TextInput
                  value={draftName}
                  onChangeText={(t) => {
                    setDraftName(t);
                    setNameErr('');
                  }}
                  placeholder="Your name"
                  placeholderTextColor={COLORS.muted}
                  maxLength={14}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={cs.input}
                />
                <Btn
                  kind="gold"
                  small
                  label="Save"
                  onPress={() => {
                    if (!cleanName(draftName)) setNameErr('Use 2 to 14 letters, numbers, spaces, dots, dashes or underscores.');
                    else useName.getState().set(draftName);
                  }}
                />
              </View>
              {nameErr ? (
                <T v="bold" style={{ color: COLORS.red, fontSize: 12 }}>
                  {nameErr}
                </T>
              ) : null}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const cs = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#04081788' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '78%', backgroundColor: COLORS.bg2, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 2, borderColor: COLORS.line, paddingHorizontal: 14, paddingTop: 14 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderColor: COLORS.line },
  empty: { alignItems: 'center', gap: 6, padding: 30 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 2, borderRadius: 16, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 7 },
  bubbleMine: { backgroundColor: COLORS.gold, borderColor: '#ffe08a', borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  emoteRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  emote: { width: 46, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000044', borderWidth: 1, borderColor: COLORS.line },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 44, borderRadius: 14, borderWidth: 2, borderColor: COLORS.line, backgroundColor: '#00000044', color: COLORS.text, paddingHorizontal: 12, fontFamily: F.body },
});

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
      <View style={styles.promptCard}>
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
      </View>
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
  bottom: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, gap: 6 },
  navScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  nav: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 8, justifyContent: 'center' },
  navBtn: { flex: 1, maxWidth: 140, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070d20f2', borderWidth: 2 },
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
  promptCard: { width: '88%', maxWidth: 380, gap: 10, padding: 16, borderRadius: 16, backgroundColor: '#0f1b45', borderWidth: 2, borderColor: COLORS.gold2 },
  howCard: { width: '92%', maxWidth: 420, gap: 8, padding: 16, borderRadius: 16, backgroundColor: '#0f1b45', borderWidth: 2, borderColor: COLORS.gold2 },
  howRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  promptScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#070d20cc', alignItems: 'center', justifyContent: 'center' },
  backWrap: { position: 'absolute', left: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: '#070d20e6', borderWidth: 1.5, borderColor: COLORS.gold2 },
});
