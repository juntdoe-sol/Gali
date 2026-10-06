import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { adjacent, bestKey, CHALLENGES, mastery, MINES, utcDay, type Challenge, type Mine, type Rock, type Tool } from '../game/expedition';
import { useExpedition } from '../game/expeditionStore';
import { useGame } from '../game/store';
import { useWorld } from '../game/world';
import { useView } from '../pixel/view';
import { T } from './kit';

export function ExpeditionButton({ label, onPress, disabled = false, selected = false }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={[styles.button, selected && styles.selected, disabled && { opacity: 0.5 }]}><T v="bold" style={{ textAlign: 'center' }}>{label}</T></Pressable>;
}

export function ExpeditionEntry() {
  const inset = useSafeAreaInsets();
  const dock = useGame((s) => s.dockOpen);
  const focus = useView((s) => s.focus);
  if (dock || focus >= 0) return null;
  return <View style={{ position: 'absolute', bottom: inset.bottom + 122, alignSelf: 'center' }}>
    <ExpeditionButton label="Free daily expedition" onPress={() => useExpedition.getState().show()} />
  </View>;
}
const ROCK_COLOR: Record<Rock, string> = { clay: '#614631', rubble: '#444c59', basalt: '#292f48', crystal: '#28545c', relic: '#634963' };
const MARK: Record<Rock, string> = { clay: 'C', rubble: 'R', basalt: 'B', crystal: '◆', relic: '★' };
const TOOL_HELP: Record<Tool, string> = {
  pickaxe: 'Pickaxe: 2 stamina, 3 strength. Safe on crystals and relics.',
  drill: 'Drill: 3 stamina, 6 strength. Breaks basalt fast; shatters crystals and relics.',
  shovel: 'Shovel: 1 stamina, 3 strength on clay/rubble/relics; only 1 on basalt/crystals. Gentle.',
};

export function ExpeditionPanel() {
  const s = useExpedition();
  const insets = useSafeAreaInsets();
  const [mine, setMine] = useState<Mine>('crystal');
  const [challenge, setChallenge] = useState<Challenge>('standard');
  const [tool, setTool] = useState<Tool>('pickaxe');
  const [now, setNow] = useState(Date.now());
  const scores = useWorld((w) => w.expeditionScores);
  const status = useWorld((w) => w.status);
  const delivery = useWorld((w) => w.expeditionDelivery);
  const me = useWorld((w) => w.me);
  useEffect(() => {
    if (!s.open) return;
    const tick = () => { setNow(Date.now()); useExpedition.getState().action('tick'); };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [s.open]);
  if (!s.open) return null;
  const run = s.run;
  const active = run?.status === 'active';
  const { xp, title } = mastery(s.progress);
  const day = utcDay(now);
  const today = scores.filter((p) => p.day === day && p.mine === mine && p.challenge === challenge);
  const total = today.reduce((n, p) => n + p.score, 0);
  const best = s.progress.best[bestKey({ day, mine, challenge })] ?? 0;
  return <Modal visible animationType="slide" onRequestClose={s.close}>
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]} accessibilityViewIsModal>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><T v="display" style={styles.title}>Mining expeditions</T><T v="muted">{s.shaft === null ? 'Free daily challenge · no wallet needed' : `Spot ${s.shaft + 1} shaft · separate free gameplay`}</T></View>
        <ExpeditionButton label="Close" onPress={s.close} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <T>Game XP and materials are nonfinancial. No token rewards or prizes. Tools and mastery never change SOL/ORE odds, payouts or claims.</T>
        <T v="bold">{title} · {xp} local game XP</T>
        <T v="muted">{s.storage}</T>
        {s.storage.startsWith('Save failed') ? <ExpeditionButton label="Retry local save" onPress={s.save} /> : null}
        {!active ? <>
          <T v="bold">Choose a daily mine · {day} UTC</T>
          {(Object.keys(MINES) as Mine[]).map((m) => <ExpeditionButton key={m} label={MINES[m]} selected={mine === m} onPress={() => setMine(m)} />)}
          <T v="muted">Crystal cavern: fragile finds. Collapsed tunnel: soft rubble. Deep seam: hard basalt. Same layout for everyone each UTC day.</T>
          {(Object.keys(CHALLENGES) as Challenge[]).map((c) => <ExpeditionButton key={c} label={`${CHALLENGES[c].name} · ${CHALLENGES[c].seconds}s · ${CHALLENGES[c].stamina} stamina${xp < CHALLENGES[c].xp ? ` · unlock at ${CHALLENGES[c].xp} XP` : ''}`}
            selected={challenge === c} disabled={xp < CHALLENGES[c].xp} onPress={() => setChallenge(c)} />)}
          <T v="muted">30 XP unlocks Fragile survey; 80 XP unlocks Short shift. Best-score improvements only; replaying the same score adds no XP. All three starter tools are free.</T>
          <ExpeditionButton label={s.ready ? `Start ${MINES[mine]}` : 'Loading progress…'} disabled={!s.ready} onPress={() => { setTool('pickaxe'); setNow(Date.now()); s.start(mine, challenge); }} />
          <T v="bold">Today's best: {best}</T>
        </> : null}
        {run ? <View style={styles.section}>
          <T v="display" style={styles.title}>{MINES[run.mine]} · {CHALLENGES[run.challenge].name}</T>
          <T v="bold">{active ? `${Math.max(0, Math.ceil((run.deadline - now) / 1000))}s left · ${run.stamina} stamina` : run.status === 'timeout' ? 'Shift ended · 0 score' : `Extracted · ${run.score} score`}</T>
          <T>{run.materials} game materials · {run.relics} intact relics · {run.damaged} shattered</T>
          {active ? <>
            <T v="muted">Tap a neighboring tile to dig or move. No diagonals. Extract from anywhere, even at zero stamina. Timer continues when closed.</T>
            <View style={styles.tools}>{(['pickaxe', 'drill', 'shovel'] as Tool[]).map((t) => <View key={t} style={{ flex: 1 }}><ExpeditionButton label={t} selected={tool === t} onPress={() => setTool(t)} /></View>)}</View>
            <T>{TOOL_HELP[tool]}</T>
            <View style={styles.grid}>
              {run.cells.map((cell, i) => {
                const near = adjacent(run.position, i);
                const here = run.position === i;
                return <Pressable key={i} accessibilityRole="button" accessibilityLabel={`Row ${Math.floor(i / 5) + 1} column ${i % 5 + 1}, ${here ? 'you are here' : cell.hp ? `${cell.rock}, strength ${cell.hp}` : 'cleared'}, ${near ? 'adjacent' : 'not adjacent'}`}
                  accessibilityState={{ disabled: !near, selected: here }} disabled={!near} onPress={() => s.action({ tile: i, tool })}
                  style={[styles.cell, { backgroundColor: cell.hp ? ROCK_COLOR[cell.rock] : '#101b25', borderColor: here ? COLORS.gold : near ? COLORS.teal : '#586079', borderWidth: near || here ? 3 : 1 }]}>
                  <T v="bold" style={{ fontSize: 18 }}>{here ? 'YOU' : cell.hp ? MARK[cell.rock] : '·'}</T>
                  <T style={{ fontSize: 11 }}>{cell.hp ? cell.hp : here ? 'HERE' : 'clear'}</T>
                </Pressable>;
              })}
            </View>
            <T v="muted">C clay · R rubble · B basalt · ◆ crystal · ★ relic. Drill damages ◆ and ★. Score: 2 per material + 10 per intact relic.</T>
          </> : null}
          <View accessibilityLiveRegion="polite"><T v="bold">{run.message}</T></View>
          {run.status === 'timeout' ? <T v="muted">Only unextracted expedition materials were lost. Your wallet and on-chain claims are unaffected.</T> : null}
        </View> : null}
        <View style={styles.section}>
          <T v="display" style={styles.title}>Shared daily survey</T>
          <T>{MINES[mine]} · {CHALLENGES[challenge].name} · {day} UTC</T>
          <T v="bold">{total} / 300 session score objective · {today.length} session contributions</T>
          <T>{status === 'online' ? 'Realtime connected' : 'Offline / reconnecting · local play still works'} · {delivery === 'sent' ? 'broadcast sent (not verified)' : delivery === 'failed' ? 'send failed; retrying while connected' : delivery === 'sending' ? 'sending score' : 'local scores only'}</T>
          <T v="muted">Unverified session scores; no prizes. Best per session/mine/challenge, not a global leaderboard. Receives connected peers; no server history. IDs are not verified people. Reload starts a new session; local bests remain.</T>
          {today.length ? [...today].sort((a, b) => b.score - a.score).slice(0, 8).map((p) => <T key={p.id}>{p.id === me ? 'You' : `Guest ${p.id}`} · {p.score}</T>) : <T v="muted">No contributions received for this survey yet. Extract to contribute.</T>}
        </View>
      </ScrollView>
      {active ? <View style={styles.footer}><ExpeditionButton label="Extract now · bank game score" onPress={() => s.action('extract')} /></View> : null}
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 12, gap: 10 },
  title: { fontSize: 26, color: COLORS.gold },
  button: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.trim, borderRadius: 10, backgroundColor: '#182b48' },
  selected: { borderColor: COLORS.teal, borderWidth: 2, backgroundColor: '#214b4a' },
  section: { padding: 10, gap: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, backgroundColor: COLORS.card },
  tools: { flexDirection: 'row', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { width: '18.5%', minHeight: 56, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  footer: { paddingHorizontal: 12, paddingTop: 8 },
});
