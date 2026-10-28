/**
 * The menu: Quest, Rounds, MINE, Boost (Gali program flag), Ranks, Chat.
 *
 * Phone: a bar along the bottom, MINE raised in the middle (it opens or closes the deploy panel).
 * Desktop: a rail down the left side, MINE at the top, every tab labelled with its key.
 * It hides on a phone while you are inside a spot's mine, where the spot panel owns the bottom.
 */
import { FEATURE_GALI_PROGRAM } from '../config/features';
import { Image, Pressable, ScrollView, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLobby } from '../game/lobby';
import { COLORS } from '../game/constants';
import { useGame } from '../game/store';
import { useView } from '../pixel/view';
import { FocusRing, Kbd, PixelBox, T, TONE, U } from './kit';
import { LANDSCAPE_APP, layoutNow, RAIL_W, useLayout } from './layout';

/** the landscape app's rail: smaller icons and labels, no logo, scrolls if a short screen needs it */
const C = LANDSCAPE_APP;
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

export type SheetTab = 'quests' | 'rounds' | 'skr' | 'ranks' | 'clans' | 'me';

/** Height of the bar above the safe-area inset. The panel and the map frame sit on top of it. */
export const BAR_H = 64;

/** Kept for screens that still draw the old tab art. */
export const TAB_ICON: Record<SheetTab | 'chat' | 'mine', ImageSourcePropType> = {
  quests: require('../../assets/ui/tab-quest.png'),
  rounds: require('../../assets/ui/tab-rounds.png'),
  skr: require('../../assets/ui/tab-boost.png'),
  ranks: require('../../assets/ui/tab-ranks.png'),
  clans: require('../../assets/ui/tab-me.png'),
  me: require('../../assets/ui/tab-me.png'),
  chat: require('../../assets/ui/tab-chat.png'),
  mine: require('../../assets/brand/logo.png'),
};

export const TAB_PIX: Record<SheetTab | 'chat', PixName> = {
  quests: 'quest',
  rounds: 'hourglass',
  skr: 'bolt',
  ranks: 'trophy',
  clans: 'users',
  me: 'user',
  chat: 'chat',
};

/** Keyboard shortcuts for the tabs on a desktop browser (see useHotkeys in App.tsx). */
const TAB_KEY_ALL: Record<SheetTab | 'chat', string> = { quests: 'Q', rounds: 'R', skr: 'T', ranks: 'K', clans: 'N', me: 'P', chat: 'C' };
/** Keyboard shortcuts for the tabs this build shows. */
export const TAB_KEY = Object.fromEntries(Object.entries(TAB_KEY_ALL).filter(([t]) => t !== 'skr' || FEATURE_GALI_PROGRAM)) as Record<SheetTab | 'chat', string>;

export const SHEET_TITLE: Record<SheetTab, string> = {
  quests: 'Quests',
  rounds: 'Rounds',
  skr: 'Boost',
  ranks: 'Ranks',
  clans: 'Clans',
  me: 'Profile',
};

type Item = { id: SheetTab | 'chat'; label: string };
/** BOOST (SKR staking) needs the Gali program, so it shows only with that flag on. */
const program = (items: Item[]) => items.filter((i) => i.id !== 'skr' || FEATURE_GALI_PROGRAM);
const LEFT: Item[] = program([
  { id: 'quests', label: 'QUEST' },
  { id: 'rounds', label: 'ROUNDS' },
  { id: 'skr', label: 'BOOST' },
]);
const RIGHT: Item[] = [
  { id: 'ranks', label: 'RANKS' },
  { id: 'clans', label: 'CLANS' },
  { id: 'chat', label: 'CHAT' },
];

/** The lobby bar drops QUEST and ROUNDS (they belong to the island); the games live in the TRAVEL menu. */
const LOBBY_LEFT: Item[] = program([
  { id: 'skr', label: 'BOOST' },
  { id: 'ranks', label: 'RANKS' },
]);
const LOBBY_RIGHT: Item[] = [
  { id: 'clans', label: 'CLANS' },
  { id: 'chat', label: 'CHAT' },
];

/** The lobby's version of the bar: same tabs, but the middle button is quick travel and CHAT opens the lobby chat. */
export interface LobbyBar {
  navOpen: boolean;
  onNav: () => void;
}

export function useTabActions(active: SheetTab | null, onTab: (t: SheetTab | null) => void, inSheet?: boolean, lobby?: LobbyBar) {
  const press = (id: SheetTab | 'chat') => {
    if (id === 'chat') {
      onTab(null);
      const L = useLobby.getState();
      L.toggleChat(layoutNow().desktop && !LANDSCAPE_APP && L.where === 'lobby');
      return;
    }
    useGame.getState().setDockOpen(false);
    onTab(active === id ? null : id);
  };
  const mine = () => {
    if (lobby) {
      onTab(null);
      lobby.onNav();
      return;
    }
    onTab(null);
    const st = useGame.getState();
    st.setDockOpen(inSheet ? true : !st.dockOpen);
  };
  return { press, mine };
}

export function TabBar({ active, onTab, inSheet, lobby }: { active: SheetTab | null; onTab: (t: SheetTab | null) => void; inSheet?: boolean; lobby?: LobbyBar }) {
  const { desktop } = useLayout();
  if (desktop) return <Rail active={active} onTab={onTab} inSheet={inSheet} lobby={lobby} />;
  return <Bottom active={active} onTab={onTab} inSheet={inSheet} lobby={lobby} />;
}

function Badge({ n, tone = 'gold' }: { n: number; tone?: 'gold' | 'teal' }) {
  if (n <= 0) return null;
  return (
    <PixelBox fill={tone === 'gold' ? COLORS.gold : COLORS.teal} edge="#04060f" u={1.5} style={styles.badge}>
      <T v="display" style={{ fontSize: 13, lineHeight: 14, color: '#070d20' }}>
        {n > 9 ? '9+' : n}
      </T>
    </PixelBox>
  );
}

/* ---------------- phone: the bottom bar ---------------- */
function Bottom({ active, onTab, inSheet, lobby }: { active: SheetTab | null; onTab: (t: SheetTab | null) => void; inSheet?: boolean; lobby?: LobbyBar }) {
  const insets = useSafeAreaInsets();
  const inside = useView((s) => s.focus >= 0);
  const dockOpen = useGame((s) => s.dockOpen);
  const run = useGame((s) => s.run);
  const unread = useLobby((s) => s.unread);
  const chatOpen = useLobby((s) => s.chatOpen);
  const picked = useGame((s) => (s.dockTab === 'lite' && s.liteMode === 'all' ? 0 : s.selected.length));
  const { press, mine } = useTabActions(active, onTab, inSheet, lobby);
  const mineOn = lobby ? lobby.navOpen : dockOpen && !active;

  const item = (t: Item) => {
    const on = t.id === active || (t.id === 'chat' && chatOpen);
    return (
      <Pressable key={t.id} onPress={() => press(t.id)} style={styles.item} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
        {(st) => (
          <>
            <View style={[styles.iconWell, on && styles.iconWellOn, { transform: [{ translateY: (st as { pressed: boolean }).pressed ? U : on ? -U : 0 }] }]}>
              <PixIcon name={TAB_PIX[t.id]} size={24} style={{ opacity: on ? 1 : 0.78 }} />
            </View>
            <T v="display" style={[styles.label, { color: on ? COLORS.gold : COLORS.muted }]}>
              {t.label}
            </T>
            {t.id === 'chat' ? <Badge n={unread} /> : null}
            {(st as { focused?: boolean }).focused ? <FocusRing /> : null}
          </>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { height: BAR_H + insets.bottom, paddingBottom: insets.bottom }, inside && !inSheet && !lobby && { display: 'none' }]}>
      <View pointerEvents="none" style={styles.barBg}>
        <View style={styles.barEdge} />
        <View style={styles.barHi} />
      </View>
      {(lobby ? LOBBY_LEFT : LEFT).map(item)}
      <Pressable
        onPress={mine}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel={lobby ? 'Quick travel: island, cave, arena or games' : dockOpen ? 'Close the mine panel' : 'Open the mine panel'}
      >
        {(st) => (
          <>
            <MineButton lobby={Boolean(lobby)} on={mineOn} pressed={(st as { pressed: boolean }).pressed} running={!lobby && Boolean(run)} size={64} />
            <T v="display" style={[styles.label, { color: COLORS.gold, marginTop: 2 }]}>
              {lobby ? 'TRAVEL' : run ? 'MINING' : 'MINE'}
            </T>
            {!lobby && picked > 0 && !run && !mineOn ? (
              <View style={styles.pickBadge} accessibilityLabel={`${picked} spots selected`}>
                <Badge n={picked} tone="teal" />
              </View>
            ) : null}
          </>
        )}
      </Pressable>
      {(lobby ? LOBBY_RIGHT : RIGHT).map(item)}
    </View>
  );
}

/** The raised centre button: a gold-rimmed pixel octagon with the Gali mark, or GO in the lobby. */
function MineButton({ lobby, on, pressed, running, size }: { lobby: boolean; on: boolean; pressed: boolean; running: boolean; size: number }) {
  const t = running ? TONE.teal : TONE.gold;
  return (
    <View style={[styles.mineWrap, { width: size, height: size, marginTop: -size / 2, transform: [{ translateY: pressed ? U * 2 : 0 }] }]}>
      <PixelBox fill={t.lip} edge="#04060f" u={U * 2} style={StyleSheet.absoluteFill} />
      <PixelBox fill={on ? t.hi : t.fill} hi={t.hi} lo={t.lo} edge={t.edge} u={U * 2} style={[StyleSheet.absoluteFill, { bottom: pressed ? 0 : U * 2 }]} />
      <PixelBox fill="#0c1636" hi="#22356f" lo="#050916" edge={t.edge} u={U} style={[styles.mineFace, { bottom: (pressed ? 0 : U * 2) + 8 }]}>
        {lobby ? (
          <T v="display" style={{ fontSize: 24, lineHeight: 26, color: COLORS.gold, letterSpacing: 1 }}>
            GO
          </T>
        ) : (
          <Image source={TAB_ICON.mine} style={{ width: size * 0.62, height: size * 0.62, marginTop: -2 }} />
        )}
      </PixelBox>
    </View>
  );
}

/* ---------------- desktop: the rail ---------------- */
function Rail({ active, onTab, inSheet, lobby }: { active: SheetTab | null; onTab: (t: SheetTab | null) => void; inSheet?: boolean; lobby?: LobbyBar }) {
  const run = useGame((s) => s.run);
  const unread = useLobby((s) => s.unread);
  const chatOpen = useLobby((s) => (s.where === 'lobby' && !LANDSCAPE_APP ? !s.chatHidden : s.chatOpen));
  const picked = useGame((s) => (s.dockTab === 'lite' && s.liteMode === 'all' ? 0 : s.selected.length));
  const { press, mine: mineToggle } = useTabActions(active, onTab, inSheet, lobby);
  // the deploy panel is always open on a desktop, so MINE closes any page and brings the whole island back into view
  const mine = () => {
    if (lobby) return mineToggle();
    onTab(null);
    useView.getState().go(-1);
  };
  // the desktop rail keeps QUEST in the lobby too (the phone's bottom bar has no room for it)
  const items: Item[] = lobby ? [LEFT[0], ...LOBBY_LEFT, ...LOBBY_RIGHT] : [...LEFT, ...RIGHT];
  const tabs = items.filter((t) => t.id !== 'chat');
  const chat = items.find((t) => t.id === 'chat');

  const item = (t: Item) => {
    const on = t.id === active || (t.id === 'chat' && chatOpen);
    return (
      <Pressable key={t.id} onPress={() => press(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${t.label} (${TAB_KEY[t.id]})`} style={styles.railItem}>
        {(st) => {
          const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
          return (
            <>
              {on || hovered ? (
                <PixelBox fill={on ? '#22356f' : 'rgba(255,255,255,0.05)'} hi={on ? '#3d5aa8' : undefined} lo={on ? '#0b1430' : undefined} edge={on ? '#04060f' : 'transparent'} style={StyleSheet.absoluteFill} />
              ) : null}
              {on ? <View style={styles.railMark} /> : null}
              <View style={{ transform: [{ translateY: pressed ? U : hovered ? -U : 0 }] }}>
                <PixIcon name={TAB_PIX[t.id]} size={C ? 22 : 32} style={{ opacity: on || hovered ? 1 : 0.8 }} />
              </View>
              <T v="display" style={[styles.railLabel, { color: on ? COLORS.gold : hovered ? COLORS.text : COLORS.muted }]}>
                {t.label}
              </T>
              <Kbd k={TAB_KEY[t.id]} style={styles.railKbd} />
              {t.id === 'chat' ? <View style={styles.railBadge}><Badge n={unread} /></View> : null}
              {focused ? <FocusRing /> : null}
            </>
          );
        }}
      </Pressable>
    );
  };

  const body = (
    <>
      {C ? null : (
        <View style={styles.railBrand}>
          <Image source={require('../../assets/brand/wordmark.png')} style={styles.railLogo} resizeMode="contain" accessibilityLabel="Gali" />
          <View style={styles.beta} accessibilityLabel="Beta">
            <T v="display" style={styles.betaText}>
              BETA
            </T>
          </View>
        </View>
      )}
      {C ? null : <View style={{ flex: 1 }} />}
      {C ? null : <View style={{ gap: 4, alignSelf: 'stretch' }}>{tabs.map(item)}</View>}
      {C ? null : <View style={{ flex: 1 }} />}
      {C ? null : <View style={styles.railRule} />}
      <Pressable
        onPress={mine}
        accessibilityRole="button"
        accessibilityLabel={lobby ? 'Quick travel (G)' : 'Mine'}
        style={C ? styles.railMine : styles.railMineLow}
      >
        {(st) => (
          <>
            <MineButton lobby={Boolean(lobby)} on={Boolean(lobby?.navOpen)} pressed={(st as { pressed: boolean }).pressed} running={!lobby && Boolean(run)} size={C ? 44 : 60} />
            <T v="display" style={[styles.railLabel, { color: COLORS.gold, marginTop: 4 }]}>
              {lobby ? 'TRAVEL' : run ? 'MINING' : 'MINE'}
            </T>
            {lobby ? <Kbd k="G" style={{ marginTop: 3 }} /> : null}
            {!lobby && picked > 0 ? (
              <View style={styles.railPick}>
                <Badge n={picked} tone="teal" />
              </View>
            ) : null}
          </>
        )}
      </Pressable>
      {C ? <View style={styles.railRule} /> : null}
      {C ? <View style={{ gap: 1, alignSelf: 'stretch' }}>{tabs.map(item)}</View> : null}
      {C ? <View style={{ flex: 1 }} /> : null}
      {chat ? <View style={{ alignSelf: 'stretch', marginTop: C ? 0 : 8 }}>{item(chat)}</View> : null}
      {/* PROFILE is on the rail everywhere: island, lobby, desktop and the landscape app */}
      {(
        <View style={{ alignSelf: 'stretch', marginTop: C ? 0 : 4 }}>
          {item({ id: 'me' as SheetTab, label: 'PROFILE' })}
        </View>
      )}
    </>
  );
  return (
    <View style={styles.rail} accessibilityRole="tablist">
      <PixelBox fill="rgba(8,13,32,0.94)" hi="#22356f" lo="#04060f" edge="#04060f" style={StyleSheet.absoluteFill} />
      <View style={styles.railEdge} />
      {C ? (
        <ScrollView style={{ alignSelf: 'stretch' }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 },
  barBg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,13,32,0.96)' },
  barEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: U, backgroundColor: '#04060f' },
  barHi: { position: 'absolute', left: 0, right: 0, top: U, height: U, backgroundColor: '#2a3f7a' },
  item: { flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconWell: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  iconWellOn: {},
  label: { fontSize: 14, lineHeight: 15, letterSpacing: 1 },
  badge: { position: 'absolute', top: 4, right: 6, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  mineWrap: { alignItems: 'center', justifyContent: 'center' },
  mineFace: { position: 'absolute', left: 8, right: 8, top: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickBadge: { position: 'absolute', top: -36, right: 6 },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: RAIL_W, alignItems: 'center', paddingTop: C ? 6 : 12, paddingBottom: C ? 6 : 12, paddingHorizontal: C ? 4 : 8, zIndex: 20 },
  railEdge: { position: 'absolute', right: 0, top: 0, bottom: 0, width: U, backgroundColor: COLORS.trim, opacity: 0.6 },
  railBrand: { alignItems: 'center', marginBottom: 14 },
  railLogo: { width: 70, height: 31 },
  beta: { marginTop: 3, backgroundColor: COLORS.gold, paddingHorizontal: 5, borderWidth: 1, borderColor: '#04060f' },
  betaText: { fontSize: 12, lineHeight: 13, letterSpacing: 2, color: '#070d20' },
  railMineLow: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  railMine: { alignItems: 'center', paddingTop: C ? 16 : 30, marginBottom: C ? 0 : 4 },
  railRule: { alignSelf: 'stretch', height: U, backgroundColor: '#22356f', marginVertical: C ? 4 : 12, marginHorizontal: 6 },
  railItem: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: C ? 3 : 8, gap: C ? 1 : 3 },
  railLabel: { fontSize: C ? 11 : 14, lineHeight: C ? 12 : 15, letterSpacing: C ? 0.5 : 1 },
  railMark: { position: 'absolute', left: -8, top: 8, bottom: 8, width: U * 2, backgroundColor: COLORS.gold },
  railKbd: { position: 'absolute', right: 4, top: 4 },
  railBadge: { position: 'absolute', right: 10, top: 2 },
  railPick: { position: 'absolute', right: -6, top: 22 },
});
