/**
 * Pages for what is coming: Clans shows only "will be available soon" until it opens.
 * Also here: the period picker every rank board shares, and the SOON tag.
 */
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { PERIODS, type Period } from '../game/ranks';
import { Choice, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

/** Today, month, year, all time: one row of chips over each rank board. */
export function PeriodPicker({ period, onPick }: { period: Period; onPick: (p: Period) => void }) {
  return (
    <View style={styles.periods}>
      {PERIODS.map(([p, label]) => (
        <Choice key={p} label={label} on={period === p} onPress={() => onPick(p)} />
      ))}
    </View>
  );
}

/** A small gold SOON stamp. */
export function SoonTag({ inline }: { inline?: boolean } = {}) {
  return (
    <View style={inline ? styles.soonInline : styles.soon} pointerEvents="none">
      <T v="display" style={{ fontSize: 10, lineHeight: 11, color: '#070d20', letterSpacing: 1 }}>
        SOON
      </T>
    </View>
  );
}

/** A page for something that is not open yet: its name, a line on what it will be, and "available soon". */
export function ComingSoon({ icon, title, line }: { icon: PixName; title: string; line: string }) {
  return (
    <PixelBox fill="rgba(255,201,60,0.08)" hi={COLORS.gold} lo="#04060f" style={styles.soonCard}>
      <PixIcon name={icon} size={56} />
      <T v="display" style={{ fontSize: 26, lineHeight: 28, color: COLORS.gold, textAlign: 'center' }}>
        {title}
      </T>
      <T style={{ textAlign: 'center' }}>{line}</T>
      <View style={styles.soonInline}>
        <T v="display" style={{ fontSize: 14, lineHeight: 16, color: '#070d20', letterSpacing: 1 }}>
          WILL BE AVAILABLE SOON
        </T>
      </View>
    </PixelBox>
  );
}

export const ClansSoon = () => <ComingSoon icon="users" title="CLANS" line="Build a clan with your crew or join one, level it up together and climb the clan ranks." />;

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', gap: 6 },
  soon: { position: 'absolute', right: 3, top: -6, backgroundColor: COLORS.gold, paddingHorizontal: 4, paddingVertical: 1 },
  soonInline: { backgroundColor: COLORS.gold, paddingHorizontal: 10, paddingVertical: 4 },
  soonCard: { alignItems: 'center', gap: 12, paddingVertical: 36, paddingHorizontal: 20 },
});
