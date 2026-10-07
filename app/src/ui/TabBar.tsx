/**
 * The bottom menu: Quest, Rounds, Market, MINE, Boost, Ranks, Chat.
 *
 * MINE sits raised in the middle and opens or closes the LITE / PRO panel.
 * The other six open their page. It hides while you are inside a spot's mine,
 * where the spot panel owns the bottom of the screen.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLobby } from '../game/lobby';
import { COLORS } from '../game/constants';
import { useGame } from '../game/store';
import { useView } from '../pixel/view';
import { T } from './kit';

export type SheetTab = 'quests' | 'rounds' | 'gear' | 'skr' | 'ranks' | 'me';

/** Height of the bar above the safe-area inset. The panel and the map frame sit on top of it. */
export const BAR_H = 64;

export const TAB_ICON: Record<SheetTab | 'chat' | 'mine', ImageSourcePropType> = {
  quests: require('../../assets/ui/tab-quest.png'),
  rounds: require('../../assets/ui/tab-rounds.png'),
  gear: require('../../assets/ui/tab-store.png'),
  skr: require('../../assets/ui/tab-boost.png'),
  ranks: require('../../assets/ui/tab-ranks.png'),
  me: require('../../assets/ui/tab-me.png'),
  chat: require('../../assets/ui/tab-chat.png'),
  mine: require('../../assets/brand/logo.png'),
};

export const SHEET_TITLE: Record<SheetTab, string> = {
  quests: 'Quests',
  rounds: 'Rounds',
  gear: 'Market',
  skr: 'Boost',
  ranks: 'Ranks',
  me: 'Profile',
};

const LEFT: { id: SheetTab; label: string }[] = [
  { id: 'quests', label: 'QUEST' },
  { id: 'rounds', label: 'ROUNDS' },
  { id: 'gear', label: 'MARKET' },
];
const RIGHT: { id: SheetTab | 'chat'; label: string }[] = [
  { id: 'skr', label: 'BOOST' },
  { id: 'ranks', label: 'RANKS' },
  { id: 'chat', label: 'CHAT' },
];

/** The lobby's version of the bar: same tabs, but the middle button is quick travel and CHAT opens the lobby chat. */
export interface LobbyBar {
  navOpen: boolean;
  onNav: () => void;
}

export function TabBar({ active, onTab, inSheet, lobby }: { active: SheetTab | null; onTab: (t: SheetTab | null) => void; inSheet?: boolean; lobby?: LobbyBar }) {
  const insets = useSafeAreaInsets();
  const inside = useView((s) => s.focus >= 0);
  const dockOpen = useGame((s) => s.dockOpen);
  const run = useGame((s) => s.run);
  // one chat for the whole app: the same box and the same unread count in the lobby and on the island
  const unread = useLobby((s) => s.unread);
  const picked = useGame((s) => (s.dockTab === 'lite' && s.liteMode === 'all' ? 0 : s.selected.length));

  const press = (id: SheetTab | 'chat') => {
    if (id === 'chat') {
      onTab(null);
      useLobby.getState().setChatOpen(true);
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
  const mineOn = lobby ? lobby.navOpen : dockOpen && !active;

  const item = (t: { id: SheetTab | 'chat'; label: string }) => {
    const on = t.id === active;
    return (
      <Pressable key={t.id} onPress={() => press(t.id)} style={styles.item} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
        <Image source={TAB_ICON[t.id]} style={[styles.icon, { tintColor: on ? COLORS.gold : COLORS.muted }]} />
        <T v="black" style={[styles.label, { color: on ? COLORS.gold : COLORS.muted }]}>
          {t.label}
        </T>
        {t.id === 'chat' && unread > 0 ? (
          <View style={styles.badge}>
            <T v="black" style={{ fontSize: 9, color: '#070d20' }}>
              {unread > 9 ? '9+' : unread}
            </T>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { height: BAR_H + insets.bottom, paddingBottom: insets.bottom }, inside && !inSheet && !lobby && { display: 'none' }]}>
      <LinearGradient colors={['#101c40', '#070d20']} style={[StyleSheet.absoluteFill, styles.barBg]} />
      {LEFT.map(item)}
      <Pressable
        onPress={mine}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel={lobby ? 'Quick travel: island, cave or market' : dockOpen ? 'Close the mine panel' : 'Open the mine panel'}
      >
        <View style={[styles.mineRing, mineOn && styles.mineRingOn, !lobby && run && { borderColor: COLORS.teal }]}>
          <LinearGradient colors={['#1d3170', '#0a1430']} style={styles.mineDisc}>
            {lobby ? (
              <T v="display" style={{ fontSize: 22, color: COLORS.gold, letterSpacing: 1 }}>
                GO
              </T>
            ) : (
              <Image source={TAB_ICON.mine} style={styles.mineIcon} />
            )}
          </LinearGradient>
        </View>
        <T v="black" style={[styles.label, { color: COLORS.gold, marginTop: 2 }]}>
          {lobby ? 'TRAVEL' : run ? 'MINING' : 'MINE'}
        </T>
        {!lobby && picked > 0 && !run && !mineOn ? (
          <View style={styles.pickBadge} accessibilityLabel={`${picked} spots selected`}>
            <T v="black" style={{ fontSize: 11, color: '#070d20' }}>
              {picked}
            </T>
          </View>
        ) : null}
      </Pressable>
      {RIGHT.map(item)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 },
  barBg: { borderTopWidth: 1.5, borderColor: COLORS.trim, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  item: { flex: 1, height: BAR_H, alignItems: 'center', justifyContent: 'center', gap: 4 },
  icon: { width: 24, height: 24 },
  label: { fontSize: 9, letterSpacing: 1 },
  badge: { position: 'absolute', top: 6, right: 8, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  mineRing: { marginTop: -30, width: 66, height: 66, borderRadius: 33, padding: 3, backgroundColor: '#070d20', borderWidth: 2, borderColor: COLORS.gold2 },
  mineRingOn: { borderColor: COLORS.gold },
  mineDisc: { flex: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  pickBadge: { position: 'absolute', top: -30, right: 2, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: COLORS.teal, borderWidth: 2, borderColor: '#070d20', alignItems: 'center', justifyContent: 'center' },
  mineIcon: { width: 44, height: 44, marginTop: -2 },
});
