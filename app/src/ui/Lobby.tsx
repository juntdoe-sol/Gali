/**
 * The lobby on screen: the header, the name prompt, the chat and the buttons.
 *
 * The town itself is a canvas (pixel/LobbyView). This file opens it, hands it your miner and
 * the other players, and turns what it reports into app actions: walking through the island
 * door switches to the island, the cave door opens Cave Run.
 * It also holds the "back to lobby" pills the other screens use.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarket } from '../game/market';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, levelFromXp, xpForLevel } from '../game/constants';
import { useCave } from '../game/caveStore';
import { loadChain } from '../chain/lazy';
import { TIP_LIMITS, TIP_SKR_MINT, short } from '../chain/light';
import { announce, joinChat, joinLobby, leaveLobby, LOBBY_EMOTES, publishLobbyMe, useLobby, type LobbyMsg } from '../game/lobby';
import { saveLobbySpot, takeBootSpot } from '../game/lastSpot';
import { onRideBumped, parkAtDoor, rideMoved, startRides, stopRides, useRides } from '../game/rides';
import { visible as visibleRides } from '../game/rideRules';
import type { RideView } from '../engine/types';
import { chatWords, cleanName, LOBBY_CAP, STICKERS, stickerOf, type DoorId } from '../game/lobbyMap';
import { isOnChain, useGame, useLevelXp } from '../game/store';
import { play } from '../game/sfx';
import { brawlSnap, heal, jump, setMyPos, swing, useBrawl } from '../game/brawl';
import { useName } from '../game/username';
import type { LobbyEvent, LobbyPeerView, LobbySnap } from '../engine/lobby';
import { atlasSource } from '../pixel/atlasSource';
import LobbyView, { type LobbyRef } from '../pixel/LobbyView';
import { islandFight, islandJump, myLook } from '../pixel/PixelMine';
import { useArena } from '../game/arena';
import { useView } from '../pixel/view';
import { Bar, Btn, Choice, F, FocusRing, Frame, IconBtn, INPUT, Kbd, MapButton, PixelBox, Scrim, T, Tip, U, Window } from './kit';
import { GUTTER, LANDSCAPE_APP, RAIL_W, TOP_H, sideWidth, useChrome, useLayout } from './layout';
import { BAR_H, TabBar, type SheetTab } from './TabBar';
import { Arcade } from './Arcade';
import { PixIcon } from './PixIcon';
import { DisconnectBtn } from './Hud';
import { fx } from '../pixel/fx';
import { DANCES } from '../game/dances';
import { loadPotw, usePotw } from '../game/ranks';
import { InboxBtn } from './Dm';
import { dmReady, openDm } from '../game/dm';
import { Sticker } from './Sticker';
import { useTutorial } from '../game/tutorial';
import { FightPad } from './ActionPad';
import { TouchZone, useDomZones, zoneEvent } from './zones';
import type { PixName } from './pixIcons';
import { GAME_IDS, GAME_META, useArcade, type GameId } from '../game/arcade';
import { HollowBadge } from './Season';

const GAME_SHORT: Record<GameId, string> = { tunnel: 'TUNNEL', pot: 'GOLD RUSH', crash: 'CRASH CART' };

const DOOR_UI: { id: DoorId; label: string; sub: string; color: string }[] = [
  { id: 'island', label: 'ISLAND', sub: 'Mine ORE', color: '#3de0c8' },
  { id: 'cave', label: 'CAVE', sub: 'Dig for XP', color: '#ff9a3d' },
  { id: 'market', label: 'MARKET', sub: 'Gear 555', color: '#b86bff' },
  { id: 'arena', label: 'ARENA', sub: 'Brawl', color: '#ff4f5e' },
];
const EMOTE_NAME: Record<string, string> = { wave: 'Wave', laugh: 'Laugh', heart: 'Love', fire: 'Fire', pick: 'Pickaxe', gem: 'Gem' };

/** The spot a Cave Run from the lobby opens under: the one you are mining, else one you picked. */
function homeSpot(): number {
  const g = useGame.getState();
  if (g.pending) for (let i = 0; i < 25; i++) if (g.pending.mask & (1 << i)) return i;
  return g.selected[0] ?? useCave.getState().spot;
}

export function LobbyScreen({ sheet, onTab }: { sheet: SheetTab | null; onTab: (t: SheetTab | null) => void }) {
  const insets = useSafeAreaInsets();
  const where = useLobby((s) => s.where);
  if (where !== 'lobby') return null;
  return <LobbyInner top={insets.top} bottomInset={insets.bottom} sheet={sheet} onTab={onTab} />;
}

function LobbyInner({ top, bottomInset, sheet, onTab }: { top: number; bottomInset: number; sheet: SheetTab | null; onTab: (t: SheetTab | null) => void }) {
  const ref = useRef<LobbyRef>(null);
  // Android: the lobby hears fingers on HIT and JUMP itself, so they work while a thumb holds the stick
  const zw = useDomZones('lobby', (z) => ref.current?.zones?.(z));
  const [atlas, setAtlas] = useState<string | null>(null);
  const spawn = useRef(useLobby.getState().spawn).current;
  // web: back on the spot you were on before a refresh
  const bootAt = useRef(spawn === 'start' ? takeBootSpot() : null).current;
  const name = useName((s) => s.name);
  const nameReady = useName((s) => s.ready);
  const [editing, setEditing] = useState(false);
  const status = useLobby((s) => s.status);
  const count = useLobby((s) => Object.keys(s.peers).length + 1);
  const lvl = levelFromXp(useLevelXp());
  const sol = useGame((s) => (isOnChain(s) ? s.wallet.sol + s.wallet.sessionSol : s.save.practiceSol));
  const [navOpen, setNavOpen] = useState(false);
  const [danceOpen, setDanceOpen] = useState(false);
  const brawlOn = useBrawl((b) => !b.off);
  const riding = useRides((r) => r.mine !== null);
  const nearRide = useRides((r) => r.near !== null);
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
    startRides();
    onRideBumped(() => useGame.getState().toast('Someone hopped on that ride first', 'info'));
    return () => {
      onRideBumped(null);
      stopRides();
      leaveLobby();
    };
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
        say: p.say && now - p.say.at < 6000 ? chatWords(p.say.t) : null,
        emoji: p.emoji && now - p.emojiAt < 3000 ? p.emoji : null,
        rd: p.rd,
      }));
      const R = useRides.getState();
      const rides: RideView[] = visibleRides(R.rides, peers.length + 1).map((r) => ({ id: r.id, k: r.kind, x: Math.round(r.x), y: Math.round(r.y), f: r.f, rider: r.rider === s.me ? 'me' : r.rider }));
      const snap: LobbySnap = {
        peers,
        say: s.mySay && now - s.mySay.at < 6000 ? chatWords(s.mySay.t) : null,
        emoji: s.myEmoji && now - s.myEmoji.at < 3000 ? s.myEmoji.e : null,
        dance: s.myDance,
        brawl: brawlSnap(now),
        potw: usePotw.getState().potw,
        rides,
        myRide: R.mine,
        nearRide: R.near,
      };
      void loadPotw();
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
  // the landscape app opens chat on demand: the map gets the whole width
  const chatHidden = useLobby((s) => s.chatHidden);
  const chatW = L.desktop && !LANDSCAPE_APP && !chatHidden ? sideWidth(L.w) : 0;
  const bottom = L.desktop ? 96 : bottomInset + BAR_H + 150;
  const topH = L.desktop ? TOP_H + GUTTER : top + 104;
  const left = L.desktop ? RAIL_W : 0;
  const right = L.desktop ? chatW + GUTTER * 2 : 0;
  const touch = !L.mouse;
  // another screen over the lobby: the lobby stops hearing keys, so they cannot walk the miner into a door
  const arenaOpen = useArena((s) => s.open);
  const caveOpen = useCave((s) => s.open);
  const arcadeOpen = useArcade((s) => !!s.game);
  const marketOpen = useMarket((s) => s.open);
  const away = arenaOpen || caveOpen || arcadeOpen || marketOpen;
  const awayRef = useRef(away);
  awayRef.current = away;
  useEffect(() => {
    const f = ref.current?.opts;
    if (typeof f === 'function') f({ top: topH, bottom, left, right, touch, away });
  }, [topH, bottom, left, right, touch, away]);

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
      if (awayRef.current || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= LOBBY_EMOTES.length) useLobby.getState().emote(LOBBY_EMOTES[n - 1]);
      else if (n === LOBBY_EMOTES.length + 1 || e.key.toLowerCase() === 'v') setDanceOpen((o) => !o);
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
      } else if (id === 'market') {
        // the vending machine: the miner steps back to the square and the Market opens over the lobby
        useLobby.setState({ spawn: 'market' });
        play('door');
        useMarket.getState().show();
      } else if (id === 'arena') {
        useLobby.setState({ spawn: 'arena' });
        if (!useName.getState().name) useGame.getState().toast('Pick a name to fight in the arena', 'info');
        else useArena.getState().show();
      }
    },
    [],
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
    if (zoneEvent(e)) return;
    switch (e.t) {
      case 'swing':
        swing('lobby', e.target, e.x, e.y);
        break;
      case 'jump':
        jump('lobby');
        break;
      case 'heal':
        heal(e.hp);
        break;
      case 'smash':
        useGame.getState().track('smash');
        break;
      case 'xp':
        useGame.getState().gainXp(e.n);
        break;
      case 'ride': {
        const was = useRides.getState().mine;
        useRides.getState().toggle();
        const now = useRides.getState().mine;
        if (now !== was) play(now !== null ? 'jump' : 'step');
        else if (was === null) useGame.getState().toast('Walk up to a cart or scooter to ride it', 'info');
        break;
      }
      case 'me':
        rideMoved(e.x, e.y, e.facing);
        setMyPos('lobby', e.x, e.y);
        saveLobbySpot(e.x, e.y);
        publishLobbyMe({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, facing: e.facing, pose: e.pose, look, lvl: lvlRef.current, wallet: useGame.getState().wallet.owner });
        break;
      case 'peer': {
        const peer = useLobby.getState().peers[e.id];
        const g = useGame.getState();
        if (!peer) break;
        if (!g.wallet.owner) g.toast('Connect a wallet to message or tip players', 'info');
        else if (!peer.wallet) g.toast(`${peer.name} has no wallet connected`, 'info');
        else if (peer.wallet === g.wallet.owner) g.toast("That's your own wallet", 'info');
        else if (dmReady()) openDm(peer.wallet, peer.name);
        else setTipTo({ id: peer.id, name: peer.name, wallet: peer.wallet });
        break;
      }
      case 'sfx':
        if (e.name === 'door') play('select');
        else if (e.name === 'swing') play('dig');
        else if (e.name === 'pop') play('bonk');
        break;
      case 'door':
        parkAtDoor(e.id);
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
    <View ref={zw.wrap} collapsable={false} onLayout={zw.onLayout} style={styles.root} pointerEvents="box-none">
      {atlas ? (
        <LobbyView
          ref={ref}
          onEvent={onEvent}
          atlas={atlas}
          look={look}
          opts={{ spawn, at: bootAt, top: topH, bottom, left, right, touch, away }}
          dom={{ style: { flex: 1, backgroundColor: '#2f7fc4' }, scrollEnabled: false, nestedScrollEnabled: false, bounces: false, overScrollMode: 'never' } as never}
        />
      ) : null}

      {L.desktop && !LANDSCAPE_APP ? <SharedChat inLobby /> : null}

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
          <HollowBadge />
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
            <InboxBtn />
            <DisconnectBtn />
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
            <HollowBadge compact />
            <NameChip name={name} lvl={lvl} status={status} onPress={() => setEditing(true)} />
          </View>
          <View style={styles.headRow} pointerEvents="box-none">
            <SolChip sol={sol} />
            <View style={{ flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <IconBtn onPress={() => setHowTo(true)} label="How to play">
                <T v="display" style={{ fontSize: 22, color: COLORS.gold }}>
                  ?
                </T>
              </IconBtn>
              <PixelBox fill="rgba(8,13,32,0.86)" hi="rgba(60,86,160,0.5)" lo="#04060f" style={styles.statusChip}>
                <PixIcon name="users" size={16} />
                <T v="display" style={{ fontSize: 16 }}>
                  {status === 'full' ? 'FULL' : status === 'online' ? `${count}` : status === 'joining' ? '...' : 'OFF'}
                </T>
              </PixelBox>
              <InboxBtn />
              <IconBtn onPress={() => onTab(sheet === 'me' ? null : 'me')} label="Profile">
                <PixIcon name="user" size={20} />
              </IconBtn>
              <DisconnectBtn />
            </View>
          </View>
        </View>
      )}

      {/* bottom: emotes and dances, then the same bar as the island (chat lives in CHAT, not over the stick) */}
      <View style={[styles.bottom, L.desktop ? { bottom: GUTTER, left: RAIL_W + GUTTER, right, alignItems: 'center' } : { bottom: bottomInset + BAR_H + 40 }]} pointerEvents="box-none">
        {status === 'full' ? (
          <PixelBox fill="rgba(60,10,16,0.9)" hi={COLORS.red} lo="#04060f" style={styles.full}>
            <T v="bold" style={{ fontSize: 13, textAlign: 'center' }}>
              The lobby holds {LOBBY_CAP} players and is full. You can still walk in, but nobody will see you until someone leaves. The island is open.
            </T>
          </PixelBox>
        ) : null}
        {danceOpen ? (
          <Frame style={[styles.danceCard, { maxWidth: Math.min(620, L.w - 24) }]}>
            <View style={styles.auraHead}>
              <PixIcon name="sparkle" size={22} />
              <T v="display" style={{ fontSize: 20, lineHeight: 22, color: COLORS.gold, flex: 1 }}>
                AURA FARMING
              </T>
              <IconBtn onPress={() => setDanceOpen(false)} label="Close" kbd="ESC">
                <PixIcon name="close" size={16} />
              </IconBtn>
            </View>
            <T v="label">Dances · walk to stop</T>
            <View style={styles.auraGrid}>
              {DANCES.map((name, i) => {
                const n = i + 1;
                return (
                  <Choice
                    key={name}
                    grow={false}
                    label={name}
                    on={myDance === n}
                    onPress={() => {
                      useLobby.getState().setDance(myDance === n ? 0 : n);
                      setDanceOpen(false);
                    }}
                  />
                );
              })}
            </View>
            <T v="label">Emotes</T>
            <View style={styles.auraGrid}>
              {LOBBY_EMOTES.map((e, i) => (
                <EmoteKey key={e} icon={e} label={`Emote ${EMOTE_NAME[e] ?? e}`} kbd={String(i + 1)} onPress={() => useLobby.getState().emote(e)} />
              ))}
            </View>
            {myDance ? (
              <Btn
                small
                kind="red"
                label={`STOP ${DANCES[myDance - 1]}`}
                onPress={() => {
                  useLobby.getState().setDance(0);
                  setDanceOpen(false);
                }}
              />
            ) : null}
          </Frame>
        ) : null}
        {!L.desktop ? (
          <View style={styles.fightRow} pointerEvents="box-none">
            <TouchZone group="lobby" onPress={() => ref.current?.jump?.()}>
              {() => <MapButton instant label="JUMP" icon={<PixIcon name="jump" size={20} />} accessibilityLabel="Jump" onPress={() => ref.current?.jump?.()} />}
            </TouchZone>
            {riding || nearRide ? (
              <TouchZone group="lobby" onPress={() => ref.current?.ride?.()}>
                {() => <MapButton instant tone={riding ? 'gold' : 'dark'} label={riding ? 'GET OFF' : 'RIDE'} icon={<PixIcon name="cart" size={20} />} accessibilityLabel={riding ? 'Get off the ride' : 'Ride the cart or scooter'} onPress={() => ref.current?.ride?.()} />}
              </TouchZone>
            ) : null}
            {brawlOn && !riding ? (
              <TouchZone group="lobby" onPress={() => ref.current?.attack?.()}>
                {() => <MapButton instant label="HIT" icon={<PixIcon name="fist" size={20} />} accessibilityLabel="Hit: swing your pickaxe" onPress={() => ref.current?.attack?.()} />}
              </TouchZone>
            ) : null}
          </View>
        ) : null}
        <PixelBox fill="rgba(8,13,32,0.9)" hi="#2d4282" lo="#04060f" shadow={2} style={[styles.emotes, L.w < 390 && { gap: 3, paddingHorizontal: 6 }]}>
          <AuraKey on={Boolean(myDance) || danceOpen} dancing={myDance ? DANCES[myDance - 1] : null} onPress={() => setDanceOpen((o) => !o)} />
          {L.desktop && !LANDSCAPE_APP ? (
            <>
              <View style={styles.emoteSep} />
              <EmoteKey icon="jump" label="Jump" kbd="SPC" onPress={() => ref.current?.jump?.()} />
              {brawlOn && !riding ? <EmoteKey icon="fist" label="Hit: left click or F" kbd="LMB" onPress={() => ref.current?.attack?.()} /> : null}
              {riding || nearRide ? <EmoteKey icon="cart" label={riding ? 'Get off (E)' : 'Ride (E)'} kbd="E" onPress={() => ref.current?.ride?.()} /> : null}
            </>
          ) : null}
        </PixelBox>
      </View>

      {LANDSCAPE_APP ? <FightPad zone="lobby" right={right + 14} bottom={GUTTER + 70} hit={brawlOn && !riding} onHit={() => ref.current?.attack?.()} onJump={() => ref.current?.jump?.()} ride={riding || nearRide ? { label: riding ? 'GET OFF' : 'RIDE', on: riding, onPress: () => ref.current?.ride?.() } : null} /> : null}

      {navOpen ? (
        <>
          <Pressable style={styles.navScrim} onPress={() => setNavOpen(false)} accessibilityLabel="Close travel menu" />
          <View style={[styles.navCol, { top: topH, bottom: bottomInset + BAR_H }, L.desktop && { left: RAIL_W + GUTTER, right: right }]} pointerEvents="box-none">
            <Window title="TRAVEL" sub="Your miner walks there and goes in" onClose={() => setNavOpen(false)} width={580}>
              <T v="label">Places</T>
              <View style={styles.nav}>
                {DOOR_UI.map((d) => (
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
        <XpBar lvl={lvl} />
      </View>
    </IconBtn>
  );
}

/** The island's XP bar, in the lobby too: level badge plus progress to the next level. */
function XpBar({ lvl }: { lvl: number }) {
  const xp = useLevelXp();
  const pct = Math.max(0, Math.min(100, ((xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100));
  return (
    <View style={styles.xp} accessible accessibilityLabel={`Level ${lvl}, ${Math.round(pct)}% to level ${lvl + 1}, ${xp.toLocaleString()} XP`}>
      <PixelBox fill={COLORS.teal} hi="#d9fbff" lo="#15809a" edge="#021418" style={styles.xpLvl}>
        <T v="display" style={{ color: '#032026', fontSize: 15, lineHeight: 16 }}>
          {lvl}
        </T>
      </PixelBox>
      <View style={{ width: 64 }}>
        <Bar pct={pct} colors={['#15809a', COLORS.teal]} height={6} />
      </View>
    </View>
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
/** The bar's one button: dances and emotes live behind it. */
function AuraKey({ on, dancing, onPress }: { on: boolean; dancing: string | null; onPress: () => void }) {
  return (
    <Pressable onPressIn={onPress} accessibilityRole="button" accessibilityLabel="Aura farming: dances and emotes">
      {(st) => {
        const { hovered, pressed } = st as { hovered?: boolean; pressed: boolean };
        return (
          <PixelBox fill={on ? 'rgba(255,201,60,0.22)' : hovered ? '#22346a' : '#0e1838'} hi={on ? COLORS.gold : '#2d4282'} lo="#04060f" style={[styles.auraKey, { transform: [{ translateY: pressed ? U : hovered ? -U : 0 }] }]}>
            <PixIcon name="sparkle" size={26} />
            <View>
              <T v="display" style={{ fontSize: 16, lineHeight: 17, color: COLORS.gold, letterSpacing: 0.5 }}>
                AURA FARMING
              </T>
              <T v="label" style={{ fontSize: 10 }}>
                {dancing ? `DANCING: ${dancing}` : 'DANCES · EMOTES'}
              </T>
            </View>
            <Kbd k="V" style={styles.emoteKbd} />
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

function EmoteKey({ icon, label, onPress, kbd, on }: { icon: PixName; label: string; onPress: () => void; kbd: string; on?: boolean }) {
  const narrow = useLayout().w < 390;
  return (
    <Pressable onPressIn={onPress} accessibilityRole="button" accessibilityLabel={label}>
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

const HOWTO_KEY = 'gali-lobby-howto-v2';

const HOWTO: { icon: PixName; title: string; body: string }[] = [
  { icon: 'star', title: 'Walk around', body: 'Joystick or tap on a phone. WASD, the arrow keys or a click on a computer. Scroll or pinch to zoom. Every miner you see is a real player. The board by the fountain points the way to every place.' },
  { icon: 'chat', title: 'Chat and stickers', body: 'Pick a name, then open CHAT to talk to everyone in the lobby and on the island. Tap a sticker to post it: GM, LFG, LET\'S MINE and more. On a computer, C shows or hides the chat.' },
  { icon: 'fist', title: 'Brawl', body: 'HIT (F or a left click) swings at the miner next to you. JUMP (Space) dodges. At 0 HP a miner is knocked down, then stands up with full HP and a shield. A KO gives XP. Nothing real is lost. Turn Brawl off in PROFILE.' },
  { icon: 'gem', title: 'Smash things', body: 'Hit pots, crates, barrels, bushes and stones to smash them. Breaking one heals you, up to 15 HP. Crack a dark ore vein with 5 hits for 1 to 10 XP. Everything grows back.' },
  { icon: 'ore', title: 'ORE Island: mine ORE', body: 'Walk down the pier, or tap GO then ORE ISLAND. Pick spots, deploy SOL, and win ORE when your spot is the gold one. Your wallet approves every deploy. Only play with SOL you can afford to lose.' },
  { icon: 'fire', title: 'Autopilot', body: 'On the island, open MINE, then PRO, and set Rounds above 1. One approval funds ORE automation, and your rounds deploy by themselves even with the app closed. STOP returns the unused SOL.' },
  { icon: 'trophy', title: 'Arena', body: 'The colosseum west of the plaza. Last Miner Standing, King of the Ring, or team up against the boss. Q, E, R, C, V and X fire your powers as you level up. Wins and KOs put you on the Brawl ranks.' },
  { icon: 'pick', title: 'Cave Run', body: 'Walk into the cave in the north west. Dig down, dodge the rocks, and earn XP. It never spends SOL.' },
  { icon: 'cart', title: 'Mini games', body: 'Three pavilions south of the plaza: Tunnel Collapse, Gold Rush Pot and Crash Cart. Stake ORE or SKR, with a new round every 40 seconds. 5% house fee. 18+ only, stake only what you can afford to lose.' },
  { icon: 'quest', title: 'Quests and ranks', body: 'QUEST has nine daily quests across the whole game, plus achievements. Claim each one for XP. RANKS shows miners by level, ORE mined on chain and Brawl points, for today, this month, this year or all time. Clans will be available soon.' },
  { icon: 'bag', title: 'Gear Market', body: 'The vending machine in front of the market hall, north east of the plaza. Browse all 555 pieces of gear coming in the first drop. BAG shows the Gali NFTs your wallet holds.' },
  { icon: 'cart', title: 'Carts and scooters', body: 'Mine carts and scooters stand all over the lobby, and anyone can take one. Walk up and press E, or tap RIDE. You roll about twice as fast. Press E again to get off: it stays where you left it for everyone. A hit knocks you off, and you cannot swing while riding.' },
  { icon: 'user', title: 'Profile and wallet', body: 'PROFILE holds your wallet, gear and settings. The power button next to it disconnects your wallet from any screen.' },
  { icon: 'wave', title: 'Back to the lobby', body: 'Every place has a LOBBY button. GO jumps straight to the island, cave, market, arena or games.' },
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
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn
            kind="ghost"
            label="REPLAY MINING TUTORIAL"
            onPress={() => {
              useTutorial.setState({ done: false, step: -1 });
              onClose();
              useLobby.getState().go('island');
            }}
            style={{ flex: 1 }}
          />
          <Btn kind="gold" label="GOT IT" onPress={onClose} style={{ flex: 1 }} />
        </View>
      </Window>
    </Scrim>
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
      g.track('tip');
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
  const hidden = useLobby((s) => s.chatHidden);
  const docked = L.desktop && !LANDSCAPE_APP && where === 'lobby';
  // the docked lobby chat is drawn by the lobby itself, under its menus and dialogs
  if (docked !== Boolean(inLobby)) return null;
  if (!open && !docked) return null;
  if (docked && hidden) return null;
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
        {docked ? (
          <IconBtn onPress={() => useLobby.getState().toggleChat(true)} label="Hide chat" kbd="C">
            <PixIcon name="close" size={18} />
          </IconBtn>
        ) : (
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
                    {stickerOf(m.text) ? <Sticker id={stickerOf(m.text) as string} size={96} /> : <T style={{ color: m.mine ? '#2b1600' : COLORS.text }}>{m.text}</T>}
                    <T v="muted" style={{ fontSize: 11, alignSelf: 'flex-end', color: m.mine ? '#6b3a00' : COLORS.muted }}>
                      {time}
                    </T>
                  </PixelBox>
                </View>
              );
            }}
          />
          {/* stickers: tap one to post it to the room */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cs.stickerRow} style={{ flexGrow: 0 }}>
            {STICKERS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  if (name && useLobby.getState().say(`[s:${s.id}]`)) useGame.getState().track('sticker');
                }}
                disabled={!name || chatStatus !== 'online'}
                accessibilityRole="button"
                accessibilityLabel={`Send the ${s.caption} sticker`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [cs.stickerKey, { transform: [{ translateY: pressed ? 2 : hovered ? -2 : 0 }], opacity: !name || chatStatus !== 'online' ? 0.45 : 1 }]}
              >
                <Sticker id={s.id} size={48} still />
              </Pressable>
            ))}
          </ScrollView>
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
  stickerRow: { gap: 6, paddingVertical: 4 },
  stickerKey: { borderRadius: 8 },
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

/** the island's walking stick radius, CSS px (engine/engine.ts draws it the same size) */
const STICK_R = 50;

/** "Back to lobby" on the island. Hidden while a panel has the screen. */
export function LobbyBack() {
  const insets = useSafeAreaInsets();
  const dockOpen = useGame((s) => s.dockOpen);
  const inside = useView((s) => s.focus >= 0);
  const where = useLobby((s) => s.where);
  const ch = useChrome(insets);
  const brawlOn = useBrawl((b) => !b.off);
  const bottom = ch.desktop ? ch.bottom : insets.bottom + BAR_H + 46;
  // a touch screen gets a walking stick bottom left, above the LOBBY pill (the canvas draws it)
  const touch = !ch.desktop || LANDSCAPE_APP;
  const shown = where === 'island' && !(dockOpen && !ch.desktop) && !inside;
  fx.stick = touch && shown ? { left: ch.left + 22 + STICK_R, bottom: bottom + 64 + STICK_R } : null;
  useEffect(() => () => void (fx.stick = null), []);
  if (!shown) return null;
  const fight = brawlOn ? <MapButton instant label="HIT" kbd={ch.desktop ? 'LMB' : undefined} icon={<PixIcon name="fist" size={20} />} accessibilityLabel="Hit: swing your pickaxe" onPress={islandFight} /> : null;
  return (
    <>
      <View style={[styles.backWrap, styles.backRow, { left: ch.left, bottom }]} pointerEvents="box-none">
        <BackPill kbd={ch.desktop ? 'L' : undefined} />
        {ch.desktop && !LANDSCAPE_APP ? fight : null}
      </View>
      {LANDSCAPE_APP ? <FightPad zone="island" small right={ch.right} bottom={bottom + 54} hit={brawlOn} onHit={islandFight} onJump={islandJump} /> : null}
      {ch.desktop ? null : (
        // phones: the action buttons sit on the right, above CAVE RUN, where a thumb rests
        <View style={[styles.actCol, { right: 12, bottom: bottom + 58 }]} pointerEvents="box-none">
          <TouchZone group="island" onPress={islandJump}>
            {() => <MapButton instant label="JUMP" icon={<PixIcon name="jump" size={20} />} accessibilityLabel="Jump" onPress={islandJump} />}
          </TouchZone>
          {fight ? (
            <TouchZone group="island" onPress={islandFight}>
              {() => fight}
            </TouchZone>
          ) : null}
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



const styles = StyleSheet.create({
  tipRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#2f7fc4', zIndex: 30 },
  head: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, gap: 8 },
  deskHead: { position: 'absolute', top: GUTTER, height: TOP_H - GUTTER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  xp: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 2 },
  xpLvl: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  deskTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44 },
  titleBox: { alignItems: 'center' },
  logo: { width: 90, height: 38 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 10 },
  dot: { width: U * 4, height: U * 4 },
  bottom: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  navScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(4,6,15,0.35)' },
  navCol: { position: 'absolute', left: 12, right: 12, alignItems: 'center', justifyContent: 'center' },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
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
  auraHead: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  auraGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  auraKey: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 50 },
  howGrid: { gap: 12, paddingVertical: 4, justifyContent: 'space-between' },
  howRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  howIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  backWrap: { position: 'absolute', left: 12 },
  backRow: { flexDirection: 'row', gap: 8 },
  fightRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  actCol: { position: 'absolute', flexDirection: 'row', gap: 8 },
});

