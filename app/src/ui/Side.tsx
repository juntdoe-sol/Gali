/**
 * The desktop side panel on the island: the round on top, the deploy controls under it,
 * always open. On a phone the same two pieces are the floating round card and the dock.
 */
import { useEffect } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { Dock, UnclaimedRow } from './Dock';
import { OreStatsPanel } from './OreStats';
import { RoundCard } from './Hud';
import { Kbd, PixelBox, T, U } from './kit';
import { GUTTER, LANDSCAPE_APP, useLayout } from './layout';
import { HideBtn, MineTab, useMinePanel } from './MineAnywhere';
import { useLobby } from '../game/lobby';

export function SidePanel() {
  const { desktop, side, mouse } = useLayout();
  const hidden = useMinePanel((st) => st.hidden);
  const onIsland = useLobby((st) => st.where === 'island');
  // M hides or shows the panel on a computer
  useEffect(() => {
    if (Platform.OS !== 'web' || !desktop || LANDSCAPE_APP) return;
    const key = (e: KeyboardEvent) => {
      if (useLobby.getState().where !== 'island') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'm') return;
      const st = useMinePanel.getState();
      st.setHidden(!st.hidden);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [desktop]);
  if (!desktop) return null;
  if (hidden) return <MineTab style={[styles.tabAt, { right: GUTTER, top: GUTTER }]} />;
  // one column on the right: (on the island) ORE stats, the round, the deploy panel, then (on the island) Unclaimed
  return (
    <View pointerEvents="box-none" style={[styles.side, { width: side, right: GUTTER, top: GUTTER, bottom: GUTTER }]}>
      {onIsland ? <OreStatsPanel /> : null}
      <RoundCard embedded />
      <PixelBox fill="rgba(15,23,52,0.95)" hi="#33498c" lo="#0c1430" shadow={2} style={styles.dockBox}>
        <View style={styles.dockHead}>
          <T v="display" style={{ fontSize: 22, lineHeight: 24, color: COLORS.gold, letterSpacing: 1 }}>
            DEPLOY
          </T>
          <T v="label" style={{ fontSize: 13, flex: 1, textAlign: 'right' }}>
            Click spots on the map
          </T>
          <HideBtn />
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
          <Dock embedded noUnclaimed={onIsland} />
        </ScrollView>
      </PixelBox>
      {onIsland ? <UnclaimedRow boxed /> : null}
      {mouse ? (
        <View style={styles.keys} accessibilityElementsHidden importantForAccessibility="no">
          <KeyHint k="CLICK" t="pick spot" />
          <KeyHint k="WASD" t="walk" />
          <KeyHint k="SPC" t="jump" />
          <KeyHint k="F" t="hit" />
          <KeyHint k="M" t="hide" />
          <KeyHint k="?" t="help" />
        </View>
      ) : null}
    </View>
  );
}

function KeyHint({ k, t }: { k: string; t: string }) {
  return (
    <View style={styles.key}>
      <Kbd k={k} />
      <T v="display" style={{ fontSize: 14, color: COLORS.muted }}>
        {t}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  side: { position: 'absolute', gap: 12, zIndex: 15 },
  // the deploy card hugs its controls; it only scrolls when the window is too short for them
  dockBox: { flexShrink: 1, minHeight: 0, paddingTop: 10 },
  tabAt: { position: 'absolute', zIndex: 15 },
  dockHead: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: U, borderColor: '#22356f', marginHorizontal: U * 2 },
  scroll: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingVertical: 2 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
