/**
 * The lobby on screen: the header, the name prompt, the chat and the buttons.
 *
 * The town itself is a canvas (pixel/LobbyView). This file opens it, hands it your miner and
 * the other players, and turns what it reports into app actions: walking through the island
 * door switches to the island, the cave door opens Cave Run, the market door opens the Market.
 * It also holds the "back to lobby" pills the other screens use.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, levelFromXp } from '../game/constants';
import { useCave } from '../game/caveStore';
import { loadChain } from '../chain/lazy';
import { TIP_LIMITS, TIP_SKR_MINT, short } from '../chain/light';
import { ACT_LIFE_MS, announce, joinChat, joinLobby, leaveLobby, LOBBY_EMOTES, publishLobbyMe, useLobby, type Act, type LobbyMsg } from '../game/lobby';
import { cleanName, LOBBY_CAP, type DoorId } from '../game/lobbyMap';
import { isOnChain, useGame, useLevelXp } from '../game/store';
import { play } from '../game/sfx';
import { brawlSnap, jump, setMyPos, swing, useBrawl } from '../game/brawl';
import { useName } from '../game/username';
import type { LobbyEvent, LobbyPeerView, LobbySnap } from '../engine/lobby';
import { atlasSource } from '../pixel/atlasSource';
import LobbyView, { type LobbyRef } from '../pixel/LobbyView';
import { islandFight, islandJump, myLook } from '../pixel/PixelMine';
import { useArena } from '../game/arena';
import { useView } from '../pixel/view';
import { Btn, Choice, F, FocusRing, Frame, IconBtn, INPUT, Kbd, MapButton, PixelBox, Scrim, T, Tip, U, Window } from './kit';
import { GUTTER, RAIL_W, TOP_H, sideWidth, useChrome, useLayout } from './layout';
import { BAR_H, TabBar, type SheetTab } from './TabBar';
import { Arcade } from './Arcade';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { GAME_IDS, GAME_META, useArcade, type GameId } from '../game/arcade';

const GAME_SHORT: Record<GameId, string> = { tunnel: 'TUNNEL', pot: 'GOLD RUSH', crash: 'CRASH CART' };

const DOOR_UI: { id: DoorId; label: string; sub: string; color: string }[] = [
  { id: 'island', label: 'ISLAND', sub: 'Mine ORE', color: '#3de0c8' },
  { id: 'cave', label: 'CAVE', sub: 'Dig for XP', color: '#ff9a3d' },
  { id: 'market', label: 'MARKET', sub: 'Gear and items', color: '#b86bff' },
  { id: 'arena', label: 'ARENA', sub: 'Brawl', color: '#ff4f5e' },
];
const EMOTE_NAME: Record<string, string> = { wave: 'Wave', laugh: 'Laugh', heart: 'Love', fire: 'Fire', pick: 'Pickaxe', gem: 'Gem' };

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
  const [danceOpen, setDanceOpen] = useState(false);
  const brawlOn = useBrawl((b) => !b.off);
  const myDance = useLobby((s) => s.myDance);
  const [howTo, setHowTo] = useState(false);
  const [tipTo, setTipTo] = useState<{ id: string; name: string; wallet: string } | null>(null);
  const sex = useName((s) => s.sex);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => ({ ...myLook(), sex }), [sex]);
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
        dance: s.myDance,
        brawl: brawlSnap(now),
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

  const L = useLayout();
  const chatW = L.desktop ? sideWidth(L.w) : 0;
  const bottom = L.desktop ? 96 : bottomInset + BAR_H + 150;
  const topH = L.desktop ? TOP_H + GUTTER : top + 104;
  const left = L.desktop ? RAIL_W : 0;
  const right = L.desktop ? chatW + GUTTER * 2 : 0;
  const touch = !L.mouse;
  useEffect(() => {
    const f = ref.current?.opts;
    if (typeof f === 'function') f({ top: topH, bottom, left, right, touch });
  }, [topH, bottom, left, right, touch]);

  // desktop keys: G travel, ? help, 1-6 emotes, 7 dance, Esc closes the top menu
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const travel = () => setNavOpen((v) => !v);
    const help = () => setHowTo(true);
    const esc = () => {
      setNavOpen(false);
      setDanceOpen(false);
      setHowTo(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= LOBBY_EMOTES.length) useLobby.getState().emote(LOBBY_EMOTES[n - 1]);
      else if (n === LOBBY_EMOTES.length + 1) setDanceOpen((o) => !o);
    };
    window.addEventListener('gali:travel', travel);
    window.addEventListener('gali:help', help);
    window.addEventListener('gali:escape', esc);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('gali:travel', travel);
      window.removeEventListener('gali:help', help);
      window.removeEventListener('gali:escape', esc);
      window.removeEventListener('keydown', key);
    };
  }, []);

  /** Go through a door: by walking in, or instantly from the travel menu. */
  const enter = useCallback(
    (id: DoorId) => {
      setNavOpen(false);
      if (id === 'island') useLobby.getState().go('island', 'island');
      else if (id === 'tunnel' || id === 'pot' || id === 'crash') {
        // walking into a pavilion: the miner steps back out to its front and the game opens over the lobby
        useLobby.setState({ spawn: id });
        if (!useGame.getState().wallet.owner) useGame.getState().toast('Connect a wallet to play', 'info');
        useArcade.getState().open(id);
      } else if (id === 'cave') {
        useLobby.setState({ spawn: 'cave' });
        useCave.getState().show(homeSpot());
      } else if (id === 'arena') {
        useLobby.setState({ spawn: 'arena' });
        if (!useName.getState().name) useGame.getState().toast('Pick a name to fight in the arena', 'info');
        else useArena.getState().show();
      } else {
        useLobby.setState({ spawn: 'market' });
        onMarket();
      }
    },
    [onMarket],
  );

  /** The travel buttons: your miner walks to the door, and goes through it on arrival. */
  const walkTo = useCallback((id: DoorId) => {
    setNavOpen(false);
    const go = ref.current?.goTo;
    if (typeof go === 'function') go(id);
    else enter(id);
  }, [enter]);

  /** The game buttons in the travel menu open a game screen over the lobby. */
  const openGame = useCallback((g: GameId) => {
    setNavOpen(false);
    if (!useGame.getState().wallet.owner) useGame.getState().toast('Connect a wallet to play', 'info');
    useArcade.getState().open(g);
  }, []);
  // stakes saved by an earlier visit are settled and paid when the lobby opens again
  useEffect(() => {
    useArcade.getState().resume();
  }, []);

  const onEvent = useCallback((e: LobbyEvent) => {
    switch (e.t) {
      case 'swing':
        swing('lobby', e.target, e.x, e.y);
        break;
      case 'jump':
        jump('lobby');
        break;
      case 'me':
        setMyPos('lobby', e.x, e.y);
        publishLobbyMe({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, facing: e.facing, pose: e.pose, look, lvl: lvlRef.current, wallet: useGame.getState().wallet.owner });
        break;
      case 'peer': {
        const peer = useLobby.getState().peers[e.id];
        const g = useGame.getState();
        if (!peer) break;
        if (!g.wallet.owner) g.toast('Connect a wallet to send tips', 'info');
        else if (!peer.wallet) g.toast(`${peer.name} has no wallet connected`, 'info');
        else if (peer.wallet === g.wallet.owner) g.toast("That's your own wallet", 'info');
        else setTipTo({ id: peer.id, name: peer.name, wallet: peer.wallet });
        break;
      }
      case 'sfx':
        if (e.name === 'door') play('select');
        else if (e.name === 'swing') play('dig');
        else if (e.name === 'pop') play('bonk');
        break;
      case 'door':
        enter(e.id);
        break;
      case 'dance-off':
        useLobby.getState().setDance(0);
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
          opts={{ spawn, top: topH, bottom, left, right, touch }}
          dom={{ style: { flex: 1, backgroundColor: '#2f7fc4' }, scrollEnabled: false, bounces: false, overScrollMode: 'never' } as never}
        />
      ) : null}

      {L.desktop ? <SharedChat inLobby /> : null}

      {/* header */}
      {L.desktop ? (
        <View style={[styles.deskHead, { left: RAIL_W + GUTTER, right }]} pointerEvents="box-none">
          <PixelBox fill="rgba(8,13,32,0.9)" hi={COLORS.trim} lo="#04060f" shadow={1} style={styles.deskTitle}>
            <PixIcon name="users" size={24} />
            <View>
              <T v="display" style={{ fontSize: 22, lineHeight: 23, color: COLORS.gold, letterSpacing: 1 }}>
                THE LOBBY
              </T>
              <View style={[styles.headRow, { justifyContent: 'flex-start' }]}>
                <View style={[styles.dot, { backgroundColor: status === 'online' ? COLORS.green : status === 'full' ? COLORS.red : '#ffb347' }]} />
                <T v="label" style={{ fontSize: 12, lineHeight: 13 }}>
                  {status === 'full' ? 'Lobby full' : status === 'online' ? `${count} miner${count === 1 ? '' : 's'} online` : status === 'joining' ? 'Joining' : 'Offline'}
                </T>
              </View>
            </View>
          </PixelBox>
          <View style={[styles.headRow, { gap: 8 }]}>
            <NameChip name={name} lvl={lvl} status={status} onPress={() => setEditing(true)} />
            <SolChip sol={sol} />
            <Tip text="How to play (?)" side="bottom" width={150}>
              <IconBtn onPress={() => setHowTo(true)} label="How to play" kbd="?">
                <T v="display" style={{ fontSize: 22, color: COLORS.gold }}>
                  ?
                </T>
              </IconBtn>
            </Tip>
          </View>
        </View>
      ) : (
        <View style={[styles.head, { paddingTop: top + 6 }]} pointerEvents="box-none">
          <View style={styles.headRow} pointerEvents="box-none">
            <View style={styles.titleBox}>
              <Image source={require('../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
              <T v="display" style={{ fontSize: 15, color: COLORS.gold, letterSpacing: 1, marginTop: -4 }}>
                LOBBY
              </T>
            </View>
            <NameChip name={name} lvl={lvl} status={status} onPress={() => setEditing(true)} />
          </View>
          <View style={styles.headRow} pointerEvents="box-none">
            <SolChip sol={sol} />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <IconBtn onPress={() => setHowTo(true)} label="How to play">
                <View style={styles.headRow}>
                  <T v="display" style={{ fontSize: 20, color: COLORS.gold, paddingLeft: 8 }}>
                    ?
                  </T>
                  <T v="display" style={{ fontSize: 16, paddingRight: 10 }}>
                    HOW TO PLAY
                  </T>
                </View>
              </IconBtn>
              <PixelBox fill="rgba(8,13,32,0.86)" hi="rgba(60,86,160,0.5)" lo="#04060f" style={styles.statusChip}>
                <PixIcon name="users" size={16} />
                <T v="display" style={{ fontSize: 16 }}>
                  {status === 'full' ? 'FULL' : status === 'online' ? `${count}` : status === 'joining' ? '...' : 'OFF'}
                </T>
              </PixelBox>
            </View>
          </View>
        </View>
      )}

      {/* bottom: the last few lines (phones), emotes, then the same bar as the island */}
      <View style={[styles.bottom, L.desktop ? { bottom: GUTTER, left: RAIL_W + GUTTER, right, alignItems: 'center' } : { bottom: bottomInset + BAR_H + 40 }]} pointerEvents="box-none">
        {status === 'full' ? (
          <PixelBox fill="rgba(60,10,16,0.9)" hi={COLORS.red} lo="#04060f" style={styles.full}>
            <T v="bold" style={{ fontSize: 13, textAlign: 'center' }}>
              The lobby holds {LOBBY_CAP} players and is full. You can still walk in, but nobody will see you until someone leaves. The island is open.
            </T>
          </PixelBox>
        ) : null}
        {L.desktop || L.h < 500 ? null : (
          <Pressable style={styles.log} onPress={() => useLobby.getState().setChatOpen(true)} accessibilityRole="button" accessibilityLabel="Open the lobby chat">
            {msgs.slice(-3).map((m) => (
              <View key={m.id} style={styles.line}>
                <T v="black" style={{ fontSize: 13, color: m.mine ? COLORS.gold : COLORS.teal }}>
                  {m.name}
                </T>
                <T v="body" style={{ fontSize: 13, flex: 1 }} numberOfLines={2}>
                  {m.text}
                </T>
              </View>
            ))}
          </Pressable>
        )}
        {danceOpen ? (
          <Frame style={styles.danceCard}>
            <T v="label">Dance</T>
            <View style={styles.danceRow}>
              {([1, 2, 3] as const).map((n) => (
                <Choice
                  key={n}
                  label={DANCE_NAMES[n - 1]}
                  on={myDance === n}
                  onPress={() => {
                    useLobby.getState().setDance(myDance === n ? 0 : n);
                    setDanceOpen(false);
                  }}
                />
              ))}
              {myDance ? (
                <Btn
                  small
                  kind="red"
                  label="STOP"
                  style={{ alignSelf: 'center' }}
                  onPress={() => {
                    useLobby.getState().setDance(0);
                    setDanceOpen(false);
                  }}
                />
              ) : null}
            </View>
          </Frame>
        ) : null}
        {!L.desktop ? (
          <View style={styles.fightRow} pointerEvents="box-none">
            <MapButton label="JUMP" icon={<PixIcon name="jump" size={20} />} accessibilityLabel="Jump" onPress={() => ref.current?.jump?.()} />
            {brawlOn ? <MapButton label="HIT" icon={<PixIcon name="fist" size={20} />} accessibilityLabel="Hit: swing your pickaxe" onPress={() => ref.current?.attack?.()} /> : null}
          </View>
        ) : null}
        <PixelBox fill="rgba(8,13,32,0.9)" hi="#2d4282" lo="#04060f" shadow={2} style={[styles.emotes, L.w < 390 && { gap: 3, paddingHorizontal: 6 }]}>
          {LOBBY_EMOTES.map((e, i) => (
            <EmoteKey key={e} icon={e} label={`Emote ${EMOTE_NAME[e] ?? e}`} kbd={String(i + 1)} onPress={() => useLobby.getState().emote(e)} />
          ))}
          <View style={styles.emoteSep} />
          <EmoteKey icon="note" label="Dance" kbd={String(LOBBY_EMOTES.length + 1)} on={Boolean(myDance) || danceOpen} onPress={() => setDanceOpen((o) => !o)} />
          {L.desktop ? (
            <>
              <View style={styles.emoteSep} />
              <EmoteKey icon="jump" label="Jump" kbd="SPC" onPress={() => ref.current?.jump?.()} />
              {brawlOn ? <EmoteKey icon="fist" label="Hit: right click or F" kbd="RMB" onPress={() => ref.current?.attack?.()} /> : null}
            </>
          ) : null}
        </PixelBox>
      </View>

      {navOpen ? (
        <>
          <Pressable style={styles.navScrim} onPress={() => setNavOpen(false)} accessibilityLabel="Close travel menu" />
          <View style={[styles.navCol, L.desktop ? { left: RAIL_W + GUTTER, top: 110, width: 420 } : { bottom: bottomInset + BAR_H + 52 }]} pointerEvents="box-none">
            <Window title="TRAVEL" sub="Your miner walks there and goes in" onClose={() => setNavOpen(false)} width={460}>
              <T v="label">Places</T>
              <View style={styles.nav}>
                {DOOR_UI.filter((d) => d.id !== 'market').map((d) => (
                  <NavTile key={d.id} label={d.label} sub={d.sub} color={d.color} icon={DOOR_ICON[d.id] ?? 'map'} onPress={() => walkTo(d.id)} />
                ))}
              </View>
              <T v="label">Mini games</T>
              <View style={styles.nav}>
                {GAME_IDS.map((g) => (
                  <NavTile key={g} label={GAME_SHORT[g]} sub="ORE · SKR" color={GAME_META[g].color} icon={g === 'tunnel' ? 'tunnel' : g === 'pot' ? 'pot' : 'cart'} onPress={() => walkTo(g)} />
                ))}
              </View>
            </Window>
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

      <ActivityFeed top={topH + 10} left={L.desktop ? RAIL_W + GUTTER : 12} />
      {tipTo ? <TipSheet to={tipTo} onClose={() => setTipTo(null)} /> : null}
      {howTo ? <HowToPlay onClose={closeHowTo} /> : null}
      <Arcade />

      {nameReady && (!name || editing) ? <NamePrompt first={!name} onDone={() => setEditing(false)} /> : null}
    </View>
  );
}

const DOOR_ICON: Partial<Record<DoorId, PixName>> = { island: 'ore', cave: 'cave', market: 'bag', arena: 'fist' };

function NameChip({ name, lvl, status, onPress }: { name: string; lvl: number; status: string; onPress: () => void }) {
  return (
    <IconBtn onPress={onPress} label="Change your name">
      <View style={[styles.headRow, { paddingHorizontal: 10 }]}>
        <View style={[styles.dot, { backgroundColor: status === 'online' ? COLORS.green : status === 'full' ? COLORS.red : '#ffb347' }]} />
        <T v="display" style={{ fontSize: 18 }} numberOfLines={1}>
          {name || 'PICK A NAME'}
        </T>
        <T v="display" style={{ fontSize: 15, color: COLORS.teal }}>
          LV {lvl}
        </T>
      </View>
    </IconBtn>
  );
}

function SolChip({ sol }: { sol: number }) {
  return (
    <PixelBox fill="rgba(8,13,32,0.86)" hi="rgba(60,86,160,0.5)" lo="#04060f" style={styles.statusChip}>
      <PixIcon name="sol" size={18} />
      <T v="display" style={{ fontSize: 18 }}>
        {sol.toFixed(sol >= 100 ? 1 : 3)}
      </T>
      <T v="display" style={{ fontSize: 15, color: COLORS.muted }}>
        SOL
      </T>
    </PixelBox>
  );
}

/** One key of the emote bar: a pixel icon on a key cap that dips when pressed. */
function EmoteKey({ icon, label, onPress, kbd, on }: { icon: PixName; label: string; onPress: () => void; kbd: string; on?: boolean }) {
  const narrow = useLayout().w < 390;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        return (
          <PixelBox fill={on ? 'rgba(255,201,60,0.22)' : hovered ? '#22346a' : '#0e1838'} hi={on ? COLORS.gold : '#2d4282'} lo="#04060f" style={[styles.emote, narrow && { width: 38, height: 40 }, { transform: [{ translateY: pressed ? U : hovered ? -U : 0 }] }]}>
            <PixIcon name={icon} size={32} />
            <Kbd k={kbd} style={styles.emoteKbd} />
            {focused ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

function NavTile({ label, sub, color, icon, onPress }: { label: string; sub: string; color: string; icon: PixName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Go to ${label}`} style={styles.navTileWrap}>
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        return (
          <PixelBox fill={hovered ? '#1d2d5e' : '#0b1430'} hi={hovered ? color : '#2d4282'} lo="#04060f" shadow={pressed ? 0 : 1} style={[styles.navTile, { transform: [{ translateY: pressed ? U : 0 }] }]}>
            <View style={[styles.navAccent, { backgroundColor: color }]} />
            <PixIcon name={icon} size={28} />
            <View style={styles.navTxt}>
              <T v="display" style={{ fontSize: 18, lineHeight: 19, color, letterSpacing: 0.5 }} numberOfLines={1}>
                {label}
              </T>
              <T v="muted" style={{ fontSize: 12 }} numberOfLines={1}>
                {sub}
              </T>
            </View>
            {focused ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

const HOWTO_KEY = 'gali-lobby-howto-v1';

const HOWTO: { icon: PixName; title: string; body: string }[] = [
  { icon: 'star', title: 'Walk around', body: 'Use the joystick or tap the map on a phone; WASD, the arrow keys or a click on a computer. Pinch or scroll to zoom. Other players are real people in the lobby right now.' },
  { icon: 'chat', title: 'Talk and react', body: 'Pick a name, then use CHAT to message everyone (Enter on a keyboard). Tap an icon to wave, laugh or show off, or the note to dance. Keys 1 to 7 do the same.' },
  { icon: 'fist', title: 'Brawl', body: 'Tap HIT (F on a keyboard) to swing at the miner next to you, in the lobby or on the island. JUMP (Space) makes a swing miss you. At 0 HP a miner is knocked down, then stands up with full HP and a short shield. A KO gives XP. Nothing real is lost: no ORE, SOL or gear. Turn Brawl off any time in PROFILE.' },
  { icon: 'gem', title: 'Island: mine ORE', body: 'Walk onto the jetty, or tap GO then ISLAND. Pick spots on the map, deploy SOL, and win ORE when your spot is the gold one. Your wallet approves every deploy. Only play with SOL you can afford to lose.' },
  { icon: 'cart', title: 'Mini games', body: 'South of the plaza are three pavilions: Tunnel Collapse, Gold Rush Pot and Crash Cart. Walk into one, or tap GO then its name, to open it. Each has an ORE table and an SKR table, with a new round every 40 seconds shared by everyone.' },
  { icon: 'tunnel', title: 'Tunnel Collapse', body: 'Pick one of five tunnels. One caves in. Miners in the other four split the stakes of the collapsed one, minus a 5% fee.' },
  { icon: 'pot', title: 'Gold Rush Pot', body: 'Buy in with a stake. One miner is drawn to take the whole pot minus 5%. Bigger stakes hold more tickets, so better odds.' },
  { icon: 'cart', title: 'Crash Cart', body: 'Pick a cash-out from 1.2x to 10x. If the cart climbs that high before it crashes you win your stake times the cash-out. If it crashes first the stake is lost.' },
  { icon: 'lock', title: 'Staking safely', body: 'Stakes are real ORE or SKR sent from your wallet, and your wallet approves each one. Winners are paid automatically, and every round can be checked with the hash shown in the game. 18+ only. Stake only what you can afford to lose.' },
  { icon: 'pick', title: 'Cave: Cave Run', body: 'Go into the cave for the Cave Run mini game. It earns XP and does not spend SOL.' },
  { icon: 'gift', title: 'Market: gear', body: 'Walk into the shop to see pickaxes, hats and pets for your miner.' },
  { icon: 'fire', title: 'Autopilot', body: 'On the island, open MINE, then PRO and set Rounds above 1. One wallet approval funds ORE automation. Your rounds then deploy by themselves, even with the app closed or your phone locked. Each round costs 0.00001 SOL extra for the network fee. STOP gets the unused SOL back.' },
  { icon: 'wave', title: 'Back to the lobby', body: 'Every place has a LOBBY button. The GO button in the bar jumps straight to the island, cave, games or market.' },
];

/** A short guide for new players, shown once and always one tap away from the lobby header. */
function HowToPlay({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { desktop } = useLayout();
  return (
    <Scrim onPress={onClose}>
      <Window title="HOW TO PLAY" onClose={onClose} width={desktop ? 860 : 520} style={{ maxHeight: '88%', marginTop: insets.top }}>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={[styles.howGrid, desktop && { flexDirection: 'row', flexWrap: 'wrap' }]} showsVerticalScrollIndicator>
          {HOWTO.map((h) => (
            <View key={h.title} style={[styles.howRow, desktop && { width: '48.5%' }]}>
              <PixelBox fill="#0b1430" hi="#2d4282" lo="#04060f" style={styles.howIcon}>
                <PixIcon name={h.icon} size={32} />
              </PixelBox>
              <View style={{ flex: 1 }}>
                <T v="display" style={{ fontSize: 19, lineHeight: 20, color: COLORS.gold }}>
                  {h.title}
                </T>
                <T v="body" style={{ fontSize: 14, lineHeight: 19 }}>
                  {h.body}
                </T>
              </View>
            </View>
          ))}
        </ScrollView>
        <Btn kind="gold" label="GOT IT" onPress={onClose} />
      </Window>
    </Scrim>
  );
}

/* ---------------- activity feed ---------------- */
function actText(a: Act): { icon: PixName; text: string; color: string } {
  switch (a.k) {
    case 'win':
      return { icon: 'trophy', text: `${a.n} won${a.sol > 0 ? ` ${a.sol} SOL` : ''}${a.pts > 0 ? ` · +${a.pts} pts` : ''}`, color: COLORS.gold };
    case 'tip':
      return { icon: 'gift', text: a.toMe ? `${a.n} tipped you ${a.a} ${a.tk}` : `${a.mine ? 'You' : a.n} tipped ${a.tn} ${a.a} ${a.tk}`, color: '#ff8fd8' };
    case 'play': {
      const game = a.g === 'tunnel' ? 'Tunnel Collapse' : a.g === 'pot' ? 'Gold Rush Pot' : 'Crash Cart';
      return { icon: a.win ? 'gem' : 'pick', text: a.win ? `${a.mine ? 'You' : a.n} won ${a.a} ${a.tk} in ${game}` : `${a.mine ? 'You' : a.n} staked ${a.a} ${a.tk} in ${game}`, color: a.win ? COLORS.gold : '#7fe3ff' };
    }
    case 'xp':
      return { icon: 'star', text: `${a.n} earned ${a.xp} XP`, color: '#7fe3ff' };
    case 'ko':
      return { icon: 'pick', text: `${a.mine ? 'You' : a.n} knocked out ${a.tn}`, color: '#ff8a70' };
    default:
      return { icon: 'wave', text: `${a.n} entered the lobby`, color: '#9ff0a8' };
  }
}

function ActItem({ a }: { a: Act }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const left = Math.max(0, ACT_LIFE_MS - (Date.now() - a.at));
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(Math.max(0, left - 220 - 900)),
      Animated.timing(v, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]).start();
  }, [a.at, v]);
  const t = actText(a);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}>
      <PixelBox fill="rgba(8,13,32,0.9)" hi={t.color} lo="#04060f" style={styles.act}>
        <View style={[styles.actEdge, { backgroundColor: t.color }]} />
        <PixIcon name={t.icon} size={18} />
        <T v="bold" style={{ fontSize: 13, flexShrink: 1 }} numberOfLines={2}>
          {t.text}
        </T>
      </PixelBox>
    </Animated.View>
  );
}

/** What players are doing: wins, tips, points. Each line fades in, stays a few seconds and is gone. */
function ActivityFeed({ top, left }: { top: number; left: number }) {
  const feed = useLobby((s) => s.feed);
  return (
    <View style={[styles.feed, { top, left }]} pointerEvents="none">
      {feed.map((a) => (
        <ActItem key={a.id} a={a} />
      ))}
    </View>
  );
}

/* ---------------- tipping ---------------- */
type TipToken = 'SOL' | 'ORE' | 'SKR';
export function TipSheet({ to, onClose }: { to: { id: string; name: string; wallet: string }; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const sol = useGame((s) => s.wallet.sol);
  const ore = useGame((s) => s.wallet.ore);
  const tokens: TipToken[] = TIP_SKR_MINT ? ['ORE', 'SKR', 'SOL'] : ['ORE', 'SOL'];
  const [token, setToken] = useState<TipToken>('ORE');
  const [amount, setAmount] = useState<number>(TIP_LIMITS.ORE[1]);
  const [busy, setBusy] = useState(false);
  const pick = (t: TipToken) => {
    setToken(t);
    setAmount(TIP_LIMITS[t][1]);
  };
  const FEE = 0.003; // network fee, plus ~0.002 SOL if the other player has no account for the token yet
  const short_ = token === 'SOL' ? sol < amount + FEE : token === 'ORE' ? ore < amount || sol < FEE : sol < FEE;
  const send = async () => {
    if (busy) return;
    const g = useGame.getState();
    if (short_) return g.toast(token === 'SOL' ? `Not enough SOL (you have ${sol.toFixed(4)})` : token === 'ORE' && ore < amount ? `Not enough ORE (you have ${ore.toFixed(4)})` : 'Keep about 0.003 SOL for the network fee', 'bad');
    setBusy(true);
    try {
      const chain = await loadChain();
      await chain.sendTip(token, new chain.PublicKey(to.wallet), amount);
      announce({ k: 'tip', to: to.id, tn: to.name, a: amount, tk: token });
      g.toast(`Sent ${amount} ${token} to ${to.name}`, 'good');
      void g.refreshWallet();
      onClose();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      g.toast(/declined|cancel|rejected/i.test(m) ? 'Cancelled in wallet' : m.slice(0, 140), /declined|cancel|rejected/i.test(m) ? 'info' : 'bad');
      setBusy(false);
    }
  };
  return (
    <Scrim onPress={busy ? undefined : onClose}>
      <Window title={`TIP ${to.name.toUpperCase()}`} sub={`To wallet ${short(to.wallet)}. Check it matches theirs: a player can claim any name.`} onClose={busy ? undefined : onClose} width={440} style={{ marginTop: insets.top }}>
        <View style={styles.tipRow}>
          {tokens.map((t) => (
            <Choice key={t} label={t} on={token === t} onPress={() => pick(t)} icon={<PixIcon name={t === 'SOL' ? 'sol' : t === 'ORE' ? 'ore' : 'skr'} size={18} />} />
          ))}
        </View>
        <View style={styles.tipRow}>
          {TIP_LIMITS[token].map((a) => (
            <Choice key={a} label={String(a)} on={amount === a} onPress={() => setAmount(a)} />
          ))}
        </View>
        <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          You approve it in your wallet. The network fee is about 0.0001 SOL{token === 'SOL' ? '.' : `, plus about 0.002 SOL if they have no ${token} account yet.`}
        </T>
        <Btn kind="gold" label={busy ? 'WAITING FOR WALLET' : `SEND ${amount} ${token}`} disabled={busy} onPress={send} />
        <Btn kind="ghost" label="CANCEL" disabled={busy} onPress={onClose} />
      </Window>
    </Scrim>
  );
}

/**
 * The one chat box. The lobby and the island's CHAT tab both open this sheet, and it shows the same room,
 * so a message sent from the island appears in the lobby and the other way round.
 */
export function SharedChat({ inLobby }: { inLobby?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const open = useLobby((s) => s.chatOpen);
  const msgs = useLobby((s) => s.msgs);
  const chatStatus = useLobby((s) => s.chatStatus);
  const where = useLobby((s) => s.where);
  const L = useLayout();
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
  // a desktop lobby keeps the chat docked down the right side; everywhere else it opens on demand
  const docked = L.desktop && where === 'lobby';
  // the docked lobby chat is drawn by the lobby itself, under its menus and dialogs
  if (docked !== Boolean(inLobby)) return null;
  if (!open && !docked) return null;
  const close = () => useLobby.getState().setChatOpen(false);
  const send = () => {
    if (!text.trim()) return;
    if (useLobby.getState().say(text)) setText('');
  };
  const status = chatStatus === 'online' ? 'Global room · lobby and island' : chatStatus === 'joining' ? 'Connecting' : 'Chat server not connected yet';
  const body = (
    <>
      <View style={cs.head}>
        <PixIcon name="chat" size={28} />
        <View style={{ flex: 1 }}>
          <T v="display" style={{ fontSize: 24, lineHeight: 26, letterSpacing: 1 }}>
            MINERS CHAT
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[cs.dot, { backgroundColor: chatStatus === 'online' ? COLORS.green : chatStatus === 'joining' ? '#ffb347' : COLORS.red }]} />
            <T v="muted" style={{ fontSize: 12 }}>
              {status}
            </T>
          </View>
        </View>
        {docked ? null : (
          <IconBtn onPress={close} label="Close chat" kbd="ESC">
            <PixIcon name="close" size={18} />
          </IconBtn>
        )}
      </View>
          <FlatList
            ref={list}
            data={msgs}
            keyExtractor={(m) => String(m.id)}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
            ListEmptyComponent={
              <View style={cs.empty}>
                <PixIcon name="pick" size={48} />
                <T v="bold" style={{ textAlign: 'center' }}>
                  No messages yet. Say hi to the other miners.
                </T>
              </View>
            }
            renderItem={({ item: m }) => {
              const time = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <View style={[cs.bubbleRow, m.mine && { justifyContent: 'flex-end' }]}>
                  <PixelBox fill={m.mine ? COLORS.gold : 'rgba(14,24,56,0.95)'} hi={m.mine ? '#fff1a6' : '#2d4282'} lo={m.mine ? '#d27a12' : '#04060f'} edge={m.mine ? '#2a1400' : '#04060f'} style={cs.bubble}>
                    {!m.mine ? (
                      <T v="black" style={{ fontSize: 12, color: COLORS.gold, marginBottom: 2 }}>
                        {m.name}
                      </T>
                    ) : null}
                    <T style={{ color: m.mine ? '#2b1600' : COLORS.text }}>{m.text}</T>
                    <T v="muted" style={{ fontSize: 11, alignSelf: 'flex-end', color: m.mine ? '#6b3a00' : COLORS.muted }}>
                      {time}
                    </T>
                  </PixelBox>
                </View>
              );
            }}
          />
          <View style={cs.emoteRow}>
            {LOBBY_EMOTES.map((e) => (
              <EmoteKey key={e} icon={e} label={`Emote ${EMOTE_NAME[e] ?? e}`} kbd="" onPress={() => useLobby.getState().emote(e)} />
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
                style={[INPUT, { flex: 1 }]}
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
                  style={[INPUT, { flex: 1 }]}
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
    </>
  );
  if (docked) {
    return (
      <View style={[cs.dock, { width: sideWidth(L.w), right: GUTTER, top: GUTTER, bottom: GUTTER }]}>
        <Frame style={{ flex: 1, padding: 14, gap: 8 }}>{body}</Frame>
      </View>
    );
  }
  if (L.desktop) {
    // the island on a desktop: a window over the bottom left of the map, the round panel stays in view
    return (
      <View style={[cs.float, { left: RAIL_W + GUTTER, bottom: GUTTER }]}>
        <Frame style={{ flex: 1, padding: 14, gap: 8 }}>{body}</Frame>
      </View>
    );
  }
  return (
    <Modal transparent visible animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={cs.backdrop} onPress={close} />
        <View style={[cs.sheet, { paddingBottom: insets.bottom + 10 }]}>
          <View pointerEvents="none" style={cs.sheetBg}>
            <View style={cs.sheetEdge} />
            <View style={cs.sheetHi} />
          </View>
          {body}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const cs = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,6,15,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '78%', paddingHorizontal: 14, paddingTop: 16, gap: 8 },
  sheetBg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,23,52,0.97)' },
  sheetEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: U, backgroundColor: '#04060f' },
  sheetHi: { position: 'absolute', left: 0, right: 0, top: U, height: U, backgroundColor: COLORS.trim },
  dock: { position: 'absolute' },
  float: { position: 'absolute', width: 380, height: 460, zIndex: 40 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: U, borderColor: '#22356f' },
  dot: { width: U * 3, height: U * 3 },
  empty: { alignItems: 'center', gap: 8, padding: 30 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '86%', paddingHorizontal: 12, paddingVertical: 7 },
  emoteRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, marginVertical: 4 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});

function NamePrompt({ first, onDone }: { first: boolean; onDone: () => void }) {
  const [v, setV] = useState(useName.getState().name);
  const [err, setErr] = useState('');
  const [sex, setSex] = useState<'m' | 'f'>(useName.getState().sex);
  const save = () => {
    if (!cleanName(v)) {
      setErr('Use 2 to 14 letters, numbers, spaces, dots, dashes or underscores.');
      return;
    }
    useName.getState().set(v);
    useName.getState().setSex(sex);
    onDone();
  };
  return (
    <Scrim>
      <Window title={first ? 'WELCOME, MINER' : 'CHANGE YOUR NAME'} sub="Pick the name other miners will see. It is only a label: it does not touch your wallet." width={420} accent={first ? COLORS.gold : undefined}>
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
          style={[INPUT, { width: '100%', fontSize: 20, textAlign: 'center', fontFamily: F.display }]}
        />
        <T v="label" style={{ textAlign: 'center' }}>
          Your miner
        </T>
        <View style={styles.tipRow}>
          {([['m', 'user', 'BOY'], ['f', 'girl', 'GIRL']] as const).map(([k, icon, label]) => (
            <Choice key={k} label={label} on={sex === k} onPress={() => setSex(k)} icon={<PixIcon name={icon} size={32} />} />
          ))}
        </View>
        {err ? (
          <T v="bold" style={{ color: COLORS.red, fontSize: 12, textAlign: 'center' }}>
            {err}
          </T>
        ) : null}
        <Btn kind="gold" label={first ? 'ENTER THE LOBBY' : 'SAVE NAME'} onPress={save} />
        {!first ? <Btn kind="ghost" small label="Cancel" onPress={onDone} /> : null}
      </Window>
    </Scrim>
  );
}

/** "Back to lobby" on the island. Hidden while a panel has the screen. */
export function LobbyBack() {
  const insets = useSafeAreaInsets();
  const dockOpen = useGame((s) => s.dockOpen);
  const inside = useView((s) => s.focus >= 0);
  const where = useLobby((s) => s.where);
  const ch = useChrome(insets);
  const brawlOn = useBrawl((b) => !b.off);
  if (where !== 'island' || (dockOpen && !ch.desktop) || inside) return null;
  const bottom = ch.desktop ? ch.bottom : insets.bottom + BAR_H + 46;
  const fight = brawlOn ? <MapButton label="HIT" kbd={ch.desktop ? 'RMB' : undefined} icon={<PixIcon name="fist" size={20} />} accessibilityLabel="Hit: swing your pickaxe" onPress={islandFight} /> : null;
  return (
    <>
      <View style={[styles.backWrap, styles.backRow, { left: ch.left, bottom }]} pointerEvents="box-none">
        <BackPill kbd={ch.desktop ? 'L' : undefined} />
        {ch.desktop ? fight : null}
      </View>
      {ch.desktop ? null : (
        // phones: the action buttons sit on the right, above CAVE RUN, where a thumb rests
        <View style={[styles.actCol, { right: 12, bottom: bottom + 58 }]} pointerEvents="box-none">
          <MapButton label="JUMP" icon={<PixIcon name="jump" size={20} />} accessibilityLabel="Jump" onPress={islandJump} />
          {fight}
        </View>
      )}
    </>
  );
}

/** The pill itself, for any screen: closes what is open and puts you back in the lobby, at the door you came out of. */
export function BackPill({ door = 'island', onBefore, kbd }: { door?: DoorId; onBefore?: () => void; kbd?: string }) {
  return (
    <MapButton
      label="LOBBY"
      kbd={kbd}
      icon={<PixIcon name="back" size={20} />}
      accessibilityLabel="Back to lobby"
      onPress={() => {
        onBefore?.();
        useLobby.getState().go('lobby', door);
      }}
    />
  );
}

const DANCE_NAMES = ['DISCO', 'POGO', 'WIGGLE'] as const;

const styles = StyleSheet.create({
  feed: { position: 'absolute', left: 12, maxWidth: 420, gap: 6, alignItems: 'flex-start' },
  act: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 10, paddingVertical: 6 },
  actEdge: { position: 'absolute', left: U, top: U, bottom: U, width: U * 2 },
  tipRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#2f7fc4', zIndex: 30 },
  head: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, gap: 8 },
  deskHead: { position: 'absolute', top: GUTTER, height: TOP_H - GUTTER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  deskTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44 },
  titleBox: { alignItems: 'center' },
  logo: { width: 90, height: 38 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 10 },
  dot: { width: U * 4, height: U * 4 },
  bottom: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  navScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(4,6,15,0.35)' },
  navCol: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  nav: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  navTileWrap: { flex: 1 },
  navTile: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, overflow: 'hidden' },
  navAccent: { position: 'absolute', left: U, top: U, bottom: U, width: U * 2 },
  navTxt: { flex: 1, paddingRight: 6, justifyContent: 'center' },
  full: { padding: 10 },
  log: { minHeight: 8, gap: 3 },
  line: { flexDirection: 'row', gap: 6, backgroundColor: 'rgba(7,13,32,0.78)', paddingHorizontal: 8, paddingVertical: 4, borderLeftWidth: U, borderColor: '#2d4282' },
  emotes: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  emote: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  emoteKbd: { position: 'absolute', right: -4, bottom: -4 },
  emoteSep: { width: U, height: 30, backgroundColor: '#22356f', marginHorizontal: 2 },
  danceCard: { alignSelf: 'center', gap: 8, padding: 12, alignItems: 'center' },
  danceRow: { flexDirection: 'row', gap: 6 },
  howGrid: { gap: 12, paddingVertical: 4, justifyContent: 'space-between' },
  howRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  howIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  backWrap: { position: 'absolute', left: 12 },
  backRow: { flexDirection: 'row', gap: 8 },
  fightRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  actCol: { position: 'absolute', flexDirection: 'row', gap: 8 },
});

