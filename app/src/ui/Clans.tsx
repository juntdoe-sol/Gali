/**
 * Clans, shown ahead of launch: what building and joining a clan will look like, marked SOON. Nothing here
 * is saved or sent yet; the buttons that would act are switched off, and the clans listed are examples.
 *
 * How clans will work:
 *   - a miner builds a clan with a custom name, a short tag and a small logo (100 x 100, GIF allowed), and owns it
 *   - other miners send a request to join; the owner approves or rejects each one
 *   - clan XP is the XP its members earn, and the clan's level rises with it
 *   - clans are ranked today, this month, this year and all time, like the miner ranks
 *
 * Also here: the period picker every rank board shares, and the SOON tag.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { COLORS } from '../game/constants';
import { PERIODS, type Period } from '../game/ranks';
import { Btn, Card, Choice, INPUT, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';

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

/** Clan XP needed for each level: 2,000 for level 2, then each level asks a little more. */
export function clanLevel(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 2000;
  let left = Math.max(0, xp);
  while (left >= need && level < 50) {
    left -= need;
    level += 1;
    need = Math.round(need * 1.35);
  }
  return { level, into: left, need };
}
export const CLAN_MAX = 30;

interface ExampleClan {
  name: string;
  tag: string;
  xp: number;
  members: number;
  owner: string;
  color: string;
}
/** Made-up clans, so the list shows what is coming. They are labelled as examples on screen. */
const EXAMPLES: ExampleClan[] = [
  { name: 'Deep Shaft Crew', tag: 'DSC', xp: 48_200, members: 24, owner: 'shaftboss', color: '#b86bff' },
  { name: 'Gold Spot Gang', tag: 'GSG', xp: 21_750, members: 17, owner: 'goldie', color: '#ffc93c' },
  { name: 'Night Diggers', tag: 'NGT', xp: 6_400, members: 8, owner: 'owl', color: '#3de0c8' },
];

export function ClansTab() {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const cleanName = (v: string) => v.replace(/[^A-Za-z0-9 ]/g, '').replace(/ {2,}/g, ' ').slice(0, 18);
  const cleanTag = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
  return (
    <View style={{ gap: 12 }}>
      <PixelBox fill="rgba(255,201,60,0.12)" hi={COLORS.gold} lo="#04060f" style={styles.hero}>
        <PixIcon name="users" size={36} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="display" style={{ fontSize: 22, lineHeight: 24, color: COLORS.gold }}>
            CLANS ARE COMING SOON
          </T>
          <T style={{ fontSize: 13 }}>Build a clan with your crew, or ask to join one. Every member's XP levels up the clan, and clans get their own ranks.</T>
        </View>
      </PixelBox>

      <Card style={{ gap: 8 }}>
        <T v="display" style={{ fontSize: 18 }}>
          HOW CLANS WILL WORK
        </T>
        {[
          ['crown', 'Build a clan: pick a name, a tag of up to 4 letters and a small logo. You own it.'],
          ['users', 'Join a clan: send a request. The owner approves or rejects it.'],
          ['star', 'Clan XP is the XP all members earn. The clan levels up with it.'],
          ['trophy', 'Clan ranks for today, this month, this year and all time.'],
        ].map(([icon, line]) => (
          <View key={line} style={styles.how}>
            <PixIcon name={icon as 'star'} size={20} />
            <T style={{ flex: 1, fontSize: 13 }}>{line}</T>
          </View>
        ))}
        <T v="muted" style={{ fontSize: 12 }}>Up to {CLAN_MAX} miners in a clan. One clan at a time. A wallet is needed to build or join.</T>
      </Card>

      <Card style={{ gap: 8 }}>
        <View style={styles.headRow}>
          <T v="display" style={{ fontSize: 18, flex: 1 }}>
            BUILD A CLAN
          </T>
          <SoonTag inline />
        </View>
        <View style={styles.logoRow}>
          <View style={styles.logoSlot}>
            <PixIcon name="star" size={22} />
            <T v="label" style={{ fontSize: 9, color: COLORS.muted }}>
              LOGO
            </T>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <T v="bold" style={{ fontSize: 13 }}>
              Clan logo
            </T>
            <T v="muted" style={{ fontSize: 11 }}>
              Only the owner can upload it. Exactly 100 x 100 pixels. PNG, JPG or GIF, and animated GIFs move.
            </T>
          </View>
          <Btn small label="UPLOAD · SOON" disabled onPress={() => undefined} />
        </View>
        <TextInput value={name} onChangeText={(v) => setName(cleanName(v))} placeholder="Clan name" placeholderTextColor={COLORS.muted} maxLength={18} style={INPUT} />
        <TextInput value={tag} onChangeText={(v) => setTag(cleanTag(v))} placeholder="Tag, up to 4 letters" placeholderTextColor={COLORS.muted} autoCapitalize="characters" maxLength={4} style={INPUT} />
        {name || tag ? (
          <T v="muted" style={{ fontSize: 12 }}>
            Your clan would show as{' '}
            <T v="bold" style={{ fontSize: 12, color: COLORS.gold }}>
              [{tag || '----'}] {name || 'Your clan'}
            </T>
          </T>
        ) : null}
        <Btn kind="gold" label="BUILD CLAN · SOON" disabled onPress={() => undefined} />
      </Card>

      <Card style={{ gap: 8 }}>
        <View style={styles.headRow}>
          <T v="display" style={{ fontSize: 18, flex: 1 }}>
            JOIN REQUESTS
          </T>
          <T v="label" style={{ color: COLORS.muted }}>
            OWNER VIEW · EXAMPLE
          </T>
        </View>
        <T v="muted" style={{ fontSize: 12 }}>
          When you own a clan, requests to join wait here until you decide.
        </T>
        {[
          ['digdug', 12],
          ['orehound', 7],
        ].map(([who, lvl]) => (
          <PixelBox key={who} fill="rgba(9,14,34,0.9)" hi="#22356f" lo="#04060f" style={styles.row}>
            <PixIcon name="user" size={22} />
            <View style={{ flex: 1 }}>
              <T v="bold" numberOfLines={1}>
                {who}
              </T>
              <T v="muted" style={{ fontSize: 11 }}>
                Level {lvl} · wants to join
              </T>
            </View>
            <Btn small kind="teal" label="APPROVE" disabled onPress={() => undefined} />
            <Btn small kind="red" label="REJECT" disabled onPress={() => undefined} />
          </PixelBox>
        ))}
      </Card>

      <View style={styles.headRow}>
        <T v="display" style={{ fontSize: 18, flex: 1 }}>
          ALL CLANS
        </T>
        <T v="label" style={{ color: COLORS.muted }}>
          EXAMPLES
        </T>
      </View>
      {EXAMPLES.map((c, k) => {
        const lv = clanLevel(c.xp);
        return (
          <PixelBox key={c.tag} fill="rgba(9,14,34,0.9)" hi="#22356f" lo="#04060f" style={styles.clan}>
            <View style={styles.headRow}>
              <T v="display" style={{ width: 30, fontSize: 20, color: k < 3 ? COLORS.gold : COLORS.muted }}>
                {k + 1}
              </T>
              <View style={[styles.logoSmall, { borderColor: c.color }]}>
                <T v="display" style={{ fontSize: 13, color: c.color }}>
                  {c.tag}
                </T>
              </View>
              <View style={{ flex: 1 }}>
                <T v="bold" numberOfLines={1}>
                  <T v="bold" style={{ color: COLORS.gold }}>
                    [{c.tag}]
                  </T>{' '}
                  {c.name}
                </T>
                <T v="muted" style={{ fontSize: 11 }}>
                  Owner {c.owner} · {c.members}/{CLAN_MAX} miners
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="display" style={{ fontSize: 18, color: COLORS.gold }}>
                  LV {lv.level}
                </T>
                <T v="muted" style={{ fontSize: 11 }}>
                  {c.xp.toLocaleString()} XP
                </T>
              </View>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round((lv.into / lv.need) * 100)}%` }]} />
            </View>
            <Btn small label="REQUEST TO JOIN · SOON" disabled onPress={() => undefined} />
          </PixelBox>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', gap: 6 },
  soon: { position: 'absolute', right: 3, top: -6, backgroundColor: COLORS.gold, paddingHorizontal: 4, paddingVertical: 1 },
  soonInline: { backgroundColor: COLORS.gold, paddingHorizontal: 4, paddingVertical: 1 },
  logoRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  logoSlot: { width: 50, height: 50, borderWidth: 2, borderStyle: 'dashed', borderColor: '#2d4282', alignItems: 'center', justifyContent: 'center', gap: 2 },
  logoSmall: { width: 40, height: 40, borderWidth: 2, backgroundColor: '#0c1430', alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  how: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  headRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 8 },
  clan: { padding: 10, gap: 8 },
  bar: { height: 6, backgroundColor: '#0c1430', borderWidth: 1, borderColor: '#22356f' },
  barFill: { height: '100%', backgroundColor: COLORS.gold },
});
