/**
 * The desktop side panel on the island: the round on top, the deploy controls under it,
 * always open. On a phone the same two pieces are the floating round card and the dock.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { Dock } from './Dock';
import { RoundCard } from './Hud';
import { Kbd, PixelBox, T, U } from './kit';
import { GUTTER, useLayout } from './layout';

export function SidePanel() {
  const { desktop, side, mouse } = useLayout();
  if (!desktop) return null;
  return (
    <View style={[styles.side, { width: side, right: GUTTER, top: GUTTER, bottom: GUTTER }]}>
      <RoundCard embedded />
      <PixelBox fill="rgba(15,23,52,0.95)" hi="#33498c" lo="#0c1430" shadow={2} style={styles.dockBox}>
        <View style={styles.dockHead}>
          <T v="display" style={{ fontSize: 22, lineHeight: 24, color: COLORS.gold, letterSpacing: 1 }}>
            DEPLOY
          </T>
          <T v="label" style={{ fontSize: 13 }}>
            Click spots on the map
          </T>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
          <Dock embedded />
        </ScrollView>
      </PixelBox>
      {mouse ? (
        <View style={styles.keys} accessibilityElementsHidden importantForAccessibility="no">
          <KeyHint k="CLICK" t="pick spot" />
          <KeyHint k="WASD" t="walk" />
          <KeyHint k="SPC" t="jump" />
          <KeyHint k="F" t="hit" />
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
  dockHead: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderBottomWidth: U, borderColor: '#22356f', marginHorizontal: U * 2 },
  scroll: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingVertical: 2 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
