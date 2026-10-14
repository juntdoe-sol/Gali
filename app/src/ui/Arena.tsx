/**
 * The Arena screen: the pit (pixel/ArenaView), the match banner, the fight buttons, the power picker,
 * the weekly ranks, and the clip of the last knockout.
 *
 * The rules live in game/arena.ts and game/brawl.ts. This file passes what the canvas reports to them,
 * and shows what they say.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, levelFromXp } from '../game/constants';
import { cheer, effectiveLoadout, grab, hostId, hurtBoss, isHost, MODE_NAME, publishArenaMe, shareThrow, sharePower, useArena, KOTH_WIN, type Mode } from '../game/arena';
import { brawlSnap, guard, jump, setMyPos, strike, swing, useBrawl } from '../game/brawl';
import { fightPoints, titleOf, TRAILS, trailUnlocked, useFightStats } from '../game/fightGear';
import { ACTIVES, PASSIVES, POWERS, baseDamage, unlocked, type PowerId } from '../game/powers';
import { useRanks } from '../game/ranks';
import { play, type Sound } from '../game/sfx';
import { useGame } from '../game/store';
import type { ArenaEvent, ArenaSnap } from '../engine/arena';
import { atlasSource } from '../pixel/atlasSource';
import ArenaView, { type ArenaRef } from '../pixel/ArenaView';
import { myLook } from '../pixel/PixelMine';
import { Btn, Card, Choice, MapButton, PixelBox, Scrim, T, Window } from './kit';
import { useLayout } from './layout';
import { BackPill, TipSheet } from './Lobby';
import { PixIcon } from './PixIcon';

const SFX: Record<string, Sound> = { swing: 'dig', hit: 'bonk', pop: 'pop', slam: 'crack', throw: 'select', pick: 'claim', cheer: 'win', ko: 'lose' };
const myLvl = () => {
  const g = useGame.getState();
  return levelFromXp(g.wallet.player ? g.wallet.player.xp + g.save.bonusXp : g.save.xp);
};

/** The arena's snapshot for the canvas. */
function snapshot(): ArenaSnap {
  const a = useArena.getState();
  const b = useBrawl.getState();
  const now = Date.now();
  const lo = effectiveLoadout(myLvl());
  return {
    me: { id: a.me, spectator: a.spectator || !a.match.fighters.includes(a.me), ammo: a.ammo, active: lo.active, passive: lo.passive, readyAt: a.readyAt, trail: a.loadout.trail, guardUntil: b.guardUntil },
    peers: Object.values(a.peers)
      .filter((p) => now - p.seen < 15_000)
      .map((p) => ({ id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(p.tx), ty: Math.round(p.ty), f: p.facing, p: p.pose, look: p.look, spectator: p.spectator, trail: p.trail, fx: p.fx })),
    brawl: brawlSnap(now),
    match: { n: a.match.n, mode: a.match.mode, phase: a.match.phase, fighters: a.match.fighters, out: a.match.out, score: a.match.score, boss: a.match.boss },
    pickups: a.pickups,
    shots: a.shots.filter((s) => now - s.at < 1200),
    cheers: a.cheers.filter((c) => now - c.at < 2500),
  };
}

/** Hit the boss: the host keeps its HP, so the host applies its own hits directly. */
function hitBoss(w: 'swing' | 'dash' | 'slam' | 'ore' | 'splash' | 'pet', x: number, y: number) {
  if (isHost()) {
    hurtBoss(baseDamage(w, useArena.getState().me, Date.now() % 997, myLvl(), true));
    return;
  }
  strike('arena', w, 'boss', x, y);
}

export function ArenaScreen() {
  const insets = useSafeAreaInsets();
  const L = useLayout();
  const open = useArena((s) => s.open);
  const ref = useRef<ArenaRef>(null);
  const [atlas, setAtlas] = useState<string | null>(null);
  const [panel, setPanel] = useState<'powers' | 'ranks' | null>(null);
  const [tipTo, setTipTo] = useState<{ id: string; name: string; wallet: string } | null>(null);
  const [clip, setClip] = useState<{ url: string; mime: string } | null>(null);
  useEffect(() => {
    if (open && !atlas) atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
  }, [open, atlas]);

  // push the arena to the canvas ten times a second, when something changed
  useEffect(() => {
    if (!open) return;
    let sent = '';
    const id = setInterval(() => {
      const snap = snapshot();
      const json = JSON.stringify(snap);
      const push = ref.current?.push;
      if (json !== sent && typeof push === 'function') {
        sent = json;
        push(snap);
      }
    }, 100);
    return () => clearInterval(id);
  }, [open]);

  const onEvent = useCallback((e: ArenaEvent) => {
    const a = useArena.getState();
    const now = Date.now();
    const cd = (p: PowerId) => useArena.setState({ readyAt: now + POWERS[p].cd });
    switch (e.t) {
      case 'me':
        setMyPos('arena', e.x, e.y);
        publishArenaMe({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, facing: e.facing, pose: e.pose });
        break;
      case 'swing':
        if (e.target === 'boss') hitBoss('swing', e.x, e.y);
        else swing('arena', e.target, e.x, e.y);
        break;
      case 'jump':
        jump('arena');
        break;
      case 'power':
        if (e.p === 'dash' || e.p === 'slam' || e.p === 'splash' || e.p === 'guard') {
          if (now < a.readyAt) return;
          cd(e.p);
          sharePower(e.p);
          if (e.p === 'guard') guard();
        } else if (e.p === 'dash-hit' || e.p === 'slam-land') {
          const w = e.p === 'dash-hit' ? 'dash' : 'slam';
          for (const t of e.targets) {
            if (t === 'boss') hitBoss(w, e.x, e.y);
            else strike('arena', w, t, e.x, e.y);
          }
        }
        break;
      case 'strike':
        if (e.target === 'boss') hitBoss(e.w, e.x, e.y);
        else strike('arena', e.w, e.target, e.x, e.y);
        break;
      case 'throw':
        shareThrow(e.x, e.y, e.dirs);
        if (e.w === 'ore') useArena.setState({ ammo: Math.max(0, a.ammo - 1) });
        break;
      case 'grab':
        grab(e.i);
        break;
      case 'peer': {
        const p = a.peers[e.id];
        const g = useGame.getState();
        if (!p) break;
        if (!g.wallet.owner) g.toast('Connect a wallet to send tips', 'info');
        else if (!p.wallet) g.toast(`${p.name} has no wallet connected`, 'info');
        else if (p.wallet !== g.wallet.owner) setTipTo({ id: p.id, name: p.name, wallet: p.wallet });
        break;
      }
      case 'clip':
        setClip((old) => {
          if (old) URL.revokeObjectURL?.(old.url);
          return { url: e.url, mime: e.mime };
        });
        break;
      case 'sfx':
        if (SFX[e.name]) play(SFX[e.name]);
        break;
      default:
        break;
    }
  }, []);

  if (!open) return null;
  const desk = L.desktop;
  const barTop = insets.top + 64;
  const barBottom = insets.bottom + (desk ? 70 : 132);
  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => useArena.getState().close()}>
      <View style={styles.screen}>
        {atlas ? (
          <ArenaView
            ref={ref}
            onEvent={onEvent}
            atlas={atlas}
            look={myLook()}
            opts={{ top: barTop, bottom: barBottom, touch: !desk }}
            dom={{ style: { flex: 1, backgroundColor: '#120c1a' }, scrollEnabled: false, bounces: false, overScrollMode: 'never' } as never}
          />
        ) : null}
        <TopBar top={insets.top + 8} onPanel={setPanel} />
        <Controls bottom={insets.bottom + 10} desk={desk} arena={ref} />
        <Banner />
        {clip ? <ClipCard clip={clip} onClose={() => setClip(null)} top={barTop + 8} /> : null}
        {panel === 'powers' ? <PowersPanel onClose={() => setPanel(null)} /> : null}
        {panel === 'ranks' ? <RanksPanel onClose={() => setPanel(null)} /> : null}
        {tipTo ? <TipSheet to={tipTo} onClose={() => setTipTo(null)} /> : null}
      </View>
    </Modal>
  );
}

function useTicker(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function TopBar({ top, onPanel }: { top: number; onPanel: (p: 'powers' | 'ranks') => void }) {
  useTicker();
  const m = useArena((s) => s.match);
  const status = useArena((s) => s.status);
  const peers = useArena((s) => s.peers);
  const me = useArena((s) => s.me);
  const left = Math.max(0, Math.ceil((m.endsAt - Date.now()) / 1000));
  const count = 1 + Object.values(peers).filter((p) => Date.now() - p.seen < 8000).length;
  const phase = m.phase === 'count' ? `STARTS IN ${left}` : m.phase === 'fight' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : m.phase === 'end' ? 'MATCH OVER' : 'WAITING';
  let sub = '';
  if (m.mode === 'lms') sub = `${m.fighters.filter((id) => !m.out.includes(id)).length} of ${m.fighters.length} standing`;
  else if (m.mode === 'koth') {
    const best = Object.entries(m.score).sort((a, b) => b[1] - a[1])[0];
    sub = best ? `${best[0] === me ? 'YOU' : peers[best[0]]?.name ?? '?'} ${Math.floor(best[1])}/${KOTH_WIN}s in the ring` : `Hold the ring alone for ${KOTH_WIN}s`;
  } else if (m.boss) sub = `Boss ${Math.ceil((m.boss.hp / m.boss.max) * 100)}% HP`;
  return (
    <View style={[styles.top, { top }]} pointerEvents="box-none">
      <BackPill door="arena" onBefore={() => useArena.getState().close()} />
      <PixelBox fill="rgba(8,13,32,0.9)" hi={COLORS.trim} lo="#04060f" shadow={1} style={styles.modeBox}>
        <T v="display" numberOfLines={1} style={{ fontSize: 17, lineHeight: 18, color: COLORS.gold, letterSpacing: 1 }}>
          {MODE_NAME[m.mode as Mode]} · {phase}
        </T>
        <T v="label" numberOfLines={1} style={{ fontSize: 11 }}>
          {status === 'online' ? `${count} here · ${sub}` : status === 'joining' ? 'Joining the arena' : 'Offline: practice against the boss'}
        </T>
      </PixelBox>
      <View style={styles.topBtns}>
        <MapButton label="POWERS" icon={<PixIcon name="bolt" size={18} />} onPress={() => onPanel('powers')} />
        <MapButton label="RANKS" icon={<PixIcon name="trophy" size={18} />} onPress={() => onPanel('ranks')} />
      </View>
    </View>
  );
}

function Controls({ bottom, desk, arena }: { bottom: number; desk: boolean; arena: { current: ArenaRef | null } }) {
  useTicker(200);
  const a = useArena();
  const lo = effectiveLoadout(myLvl());
  const fighter = a.match.fighters.includes(a.me) && !a.spectator;
  const cd = Math.max(0, Math.ceil((a.readyAt - Date.now()) / 1000));
  const act = lo.active ? POWERS[lo.active] : null;
  return (
    <View style={[styles.controls, { bottom }]} pointerEvents="box-none">
      {fighter ? (
        <View style={styles.ctrlRow} pointerEvents="box-none">
          <MapButton label="HIT" kbd={desk ? 'F' : undefined} icon={<PixIcon name="fist" size={20} />} onPress={() => arena.current?.attack?.()} />
          <MapButton label="JUMP" kbd={desk ? 'SPC' : undefined} icon={<PixIcon name="jump" size={20} />} onPress={() => arena.current?.jump?.()} />
          {act ? <MapButton label={cd ? `${act.name.split(' ')[0].toUpperCase()} ${cd}` : act.name.split(' ')[0].toUpperCase()} kbd={desk ? 'Q' : undefined} icon={<PixIcon name="bolt" size={20} />} tone={cd ? 'dark' : 'gold'} onPress={() => arena.current?.power?.()} /> : null}
          <MapButton label="THROW" count={a.ammo} kbd={desk ? 'G' : undefined} icon={<PixIcon name="ore" size={20} />} onPress={() => arena.current?.throwOre?.()} />
          <MapButton label="CHEER" icon={<PixIcon name="heart" size={18} />} onPress={() => cheer()} />
        </View>
      ) : (
        <View style={styles.ctrlRow} pointerEvents="box-none">
          <PixelBox fill="rgba(8,13,32,0.88)" hi={COLORS.trim} lo="#04060f" style={styles.watch}>
            <T v="bold" style={{ fontSize: 13, textAlign: 'center' }}>
              {a.match.phase === 'fight' ? 'You are in the stands. Cheer them on: the next match starts soon.' : 'Get ready: you are in the next match.'}
            </T>
          </PixelBox>
        </View>
      )}
      {fighter ? null : (
        <View style={styles.ctrlRow} pointerEvents="box-none">
          <MapButton label="CHEER" icon={<PixIcon name="heart" size={18} />} onPress={() => cheer()} />
        </View>
      )}
    </View>
  );
}

/** The middle of the screen: the countdown, and who won. */
function Banner() {
  useTicker(200);
  const m = useArena((s) => s.match);
  const me = useArena((s) => s.me);
  let big = '';
  let small = '';
  if (m.phase === 'count') {
    big = String(Math.max(1, Math.ceil((m.endsAt - Date.now()) / 1000)));
    small = MODE_NAME[m.mode];
  } else if (m.phase === 'end') {
    if (m.mode === 'boss') {
      big = m.winner === 'boss-down' ? 'BOSS DOWN!' : 'THE MOLE WINS';
      small = m.winner === 'boss-down' ? 'Everyone who fought gets XP' : 'Next match soon';
    } else {
      big = m.winner === me ? 'YOU WIN!' : m.winnerName ? `${m.winnerName} WINS` : 'DRAW';
      small = m.winner === me ? 'Win XP added' : 'Next match soon';
    }
  }
  if (!big) return null;
  return (
    <View style={styles.banner} pointerEvents="none">
      <T v="display" style={{ fontSize: 46, lineHeight: 48, color: COLORS.gold, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 0, textShadowOffset: { width: 3, height: 3 } }}>
        {big}
      </T>
      <T v="display" style={{ fontSize: 18, color: '#ffffff', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 0, textShadowOffset: { width: 2, height: 2 } }}>
        {small}
      </T>
    </View>
  );
}

function ClipCard({ clip, onClose, top }: { clip: { url: string; mime: string }; onClose: () => void; top: number }) {
  const ext = clip.mime.includes('mp4') ? 'mp4' : 'webm';
  const save = async () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return Linking.openURL(clip.url);
    try {
      const blob = await (await fetch(clip.url)).blob();
      const file = new File([blob], `gali-ko.${ext}`, { type: clip.mime });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'Gali Brawl KO' });
        return;
      }
    } catch {
      /* fall back to a download */
    }
    const a = document.createElement('a');
    a.href = clip.url;
    a.download = `gali-ko.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <View style={[styles.clip, { top }]} pointerEvents="box-none">
      <PixelBox fill="rgba(8,13,32,0.94)" hi={COLORS.gold} lo="#04060f" shadow={2} style={styles.clipBox}>
        <PixIcon name="eye" size={18} />
        <T v="bold" style={{ fontSize: 13, flexShrink: 1 }}>
          KO clip ready
        </T>
        <Btn small kind="gold" label="SAVE / SHARE" onPress={() => void save()} />
        <Btn small kind="ghost" label="X" onPress={onClose} />
      </PixelBox>
    </View>
  );
}

function PowersPanel({ onClose }: { onClose: () => void }) {
  const lvl = myLvl();
  const lo = useArena((s) => s.loadout);
  const eff = effectiveLoadout(lvl);
  const stats = useFightStats();
  const pts = fightPoints(stats);
  const set = useArena.getState().setLoadout;
  const row = (ids: readonly PowerId[], cur: PowerId | null, pick: (p: PowerId) => void) => (
    <View style={styles.powerList}>
      {ids.map((id) => {
        const p = POWERS[id];
        const open = unlocked(id, lvl);
        return (
          <Pressable key={id} disabled={!open} onPress={() => pick(id)} accessibilityRole="button" accessibilityLabel={`${p.name}. ${open ? p.desc : `Unlocks at level ${p.lvl}`}`}>
            <Card style={[styles.power, cur === id && { borderColor: COLORS.gold }, !open && { opacity: 0.5 }]} glow={cur === id ? COLORS.gold : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="display" style={{ fontSize: 18, color: cur === id ? COLORS.gold : COLORS.text }}>
                  {p.name.toUpperCase()}
                </T>
                <T v="label">{open ? (cur === id ? 'EQUIPPED' : 'TAP TO EQUIP') : `LV ${p.lvl}`}</T>
              </View>
              <T v="muted" style={{ fontSize: 12 }}>
                {p.desc}
                {p.kind === 'active' ? ` Cooldown ${p.cd / 1000}s.` : ''}
              </T>
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <Scrim onPress={onClose}>
      <Window title="POWERS" sub={`Level ${lvl}: one active, one passive. Powers work in the arena only.`} onClose={onClose} width={560}>
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 10 }}>
          <T v="label">Active (Q)</T>
          {row(ACTIVES, eff.active, (p) => set({ active: p as never }))}
          <T v="label">Passive</T>
          {row(PASSIVES, eff.passive, (p) => set({ passive: p as never }))}
          <T v="label">
            Swing trail · {titleOf(pts)} · {pts} fight points
          </T>
          <View style={styles.trails}>
            {TRAILS.map((t) => (
              <Choice key={t.id} label={t.name.toUpperCase()} sub={trailUnlocked(t.id, pts) ? undefined : `${t.need} pts`} disabled={!trailUnlocked(t.id, pts)} on={lo.trail === t.id} onPress={() => set({ trail: t.id })} />
            ))}
          </View>
          <T v="muted" style={{ fontSize: 12 }}>
            Fight points: 1 per KO, 3 per arena win, 2 per Mole Boss down. You have {stats.kos} KOs, {stats.wins} wins and {stats.bossWins} boss wins. Levels add at most 20% damage, and nothing here changes mining.
          </T>
        </ScrollView>
      </Window>
    </Scrim>
  );
}

function RanksPanel({ onClose }: { onClose: () => void }) {
  const r = useRanks();
  useEffect(() => {
    void useRanks.getState().load();
  }, []);
  return (
    <Scrim onPress={onClose}>
      <Window title="BRAWL RANKS" sub="This week. A KO counts when the miner who went down reports it." onClose={onClose} width={480}>
        <ScrollView style={{ maxHeight: 460 }}>
          {r.status === 'off' ? <T v="muted">Ranks are not set up on this server yet.</T> : null}
          {r.status === 'error' ? <T v="muted">Could not load the ranks. Try again in a moment.</T> : null}
          {r.status === 'loading' && !r.rows.length ? <T v="muted">Loading</T> : null}
          {r.status === 'ok' && !r.rows.length ? <T v="muted">No fights this week yet. Be the first on the board.</T> : null}
          {r.rows.map((row, i) => (
            <View key={row.name} style={styles.rankRow}>
              <T v="display" style={{ width: 34, fontSize: 18, color: i < 3 ? COLORS.gold : COLORS.muted }}>
                {i + 1}
              </T>
              <T v="bold" style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>
                {row.name}
              </T>
              <T v="label" style={{ width: 120, textAlign: 'right' }}>
                {row.kos} KO · {row.wins} WIN
              </T>
              <T v="display" style={{ width: 54, textAlign: 'right', fontSize: 18, color: COLORS.gold }}>
                {row.points}
              </T>
            </View>
          ))}
        </ScrollView>
      </Window>
    </Scrim>
  );
}

void hostId;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#120c1a' },
  top: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  modeBox: { paddingHorizontal: 12, paddingVertical: 6, flexShrink: 1, minWidth: 180 },
  topBtns: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  controls: { position: 'absolute', left: 12, right: 12, gap: 8, alignItems: 'flex-end' },
  ctrlRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  watch: { padding: 10, maxWidth: 420 },
  banner: { position: 'absolute', left: 0, right: 0, top: '38%', alignItems: 'center' },
  clip: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  clipBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  powerList: { gap: 8 },
  power: { gap: 4, padding: 10 },
  trails: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#1d2a55' },
});
