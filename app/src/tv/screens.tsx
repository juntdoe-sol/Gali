/** The TV screens: Splash, Home, Mining (with the Strike band) and Stats. Layout is in 1920x1080 dp, 5% safe margins. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Pressable, View } from 'react-native';
import { fetchBoardRound } from '../chain/board';
import { mmss, useCommunity, useCountdown, type Live } from './data';
import { C, SAFE_X, SAFE_Y } from './theme';
import { Board, Btn, KeyHints, Label, Miner, Panel, Qr, Segments, Sprite, T } from './ui';
import { pairUrl, perSpotLamports, prettyCode, stopUrl, TV_SPOTS } from './link';
import { usePairing, type Paired, type PlayState } from './play';

const MARK = require('../../assets/brand/mark512.png');
const WALL = require('../../../tv/assets/sprites/island.png');

/** The island over the dark pixel ocean. `dx` slides it for the splash pan. */
export function Wallpaper({ dx = 0, dim = 0.5, top = 40 }: { dx?: number | Animated.Value; dim?: number; top?: number }) {
  return (
    <View style={{ ...absFill, backgroundColor: C.ocean }}>
      <Animated.Image source={WALL} fadeDuration={0} style={{ position: 'absolute', left: 420, top, width: 1440, height: 840, opacity: dim, transform: [{ translateX: dx as number }] }} />
    </View>
  );
}
/** Screens with no buttons still need one focused view, or Android TV never delivers the remote's keys. */
const FocusSink = () => <Pressable focusable hasTVPreferredFocus style={{ position: 'absolute', width: 2, height: 2, opacity: 0 }} />;
const absFill = { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 };

const Safe = ({ children }: { children: ReactNode }) => <View style={{ flex: 1, paddingHorizontal: SAFE_X, paddingTop: SAFE_Y, paddingBottom: SAFE_Y - 12 }}>{children}</View>;

const Brand = ({ title = 'ORE ISLAND' }: { title?: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
    <Image source={MARK} style={{ width: 52, height: 52 }} />
    <T font="tiny" size={20} color={C.gold} style={{ letterSpacing: 6 }}>
      {title}
    </T>
  </View>
);

const Pill = ({ children, dot = C.skr }: { children: ReactNode; dot?: string }) => (
  <Panel pad={14} style={{ height: 62, paddingHorizontal: 0 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14 }}>
      <View style={{ width: 20, height: 20, backgroundColor: dot }} />
      <T font="tiny" size={15} color={C.text} style={{ letterSpacing: 3 }}>
        {children}
      </T>
    </View>
  </Panel>
);

/* ---------------- Splash ---------------- */

export function Splash({ onDone }: { onDone: () => void }) {
  const pan = useRef(new Animated.Value(-80)).current;
  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pan, { toValue: 80, duration: 2800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    Animated.timing(bar, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => finished && setTimeout(onDone, 300));
  }, [pan, bar, onDone]);
  return (
    <View style={{ flex: 1 }}>
      <Wallpaper dx={pan} dim={0.3} top={260} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Image source={MARK} style={{ width: 160, height: 160 }} />
        <T font="display" size={96} color={C.gold} style={{ letterSpacing: 6, marginTop: 12 }}>
          GALI
        </T>
        <T font="tiny" size={22} color={C.text} style={{ letterSpacing: 10, marginTop: 4 }}>
          ORE ISLAND
        </T>
        <View style={{ width: 560, height: 28, marginTop: 56, backgroundColor: C.well, borderWidth: 4, borderColor: '#1e2c5c', padding: 4 }}>
          <Animated.View style={{ height: '100%', backgroundColor: C.skr, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        </View>
        <Label style={{ marginTop: 18 }}>Loading the island</Label>
      </View>
    </View>
  );
}

/* ---------------- Home ---------------- */

const SOL_CAP = 1; // LIVE_AUTOPILOT_MAX_SOL on the phone
const ROUND_CHOICES = [1, 2, 5, 10, 25, 50, 100];

export interface Setup {
  amount: number;
  rounds: number;
}

/** Exact to the lamport-ish digits a run uses (0.025 stays 0.025), trailing zeros dropped. */
const solStr = (n: number) => (n >= 1 ? n.toFixed(3) : n.toFixed(4)).replace(/0+$/, '').replace(/\.$/, '.0');

function Stat({ value, label, color = C.text, icon }: { value: string; label: string; color?: string; icon?: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon}
        <T font="display" size={52} color={color}>
          {value}
        </T>
      </View>
      <Label size={13}>{label}</Label>
    </View>
  );
}

const Gem = ({ color }: { color: string }) => <View style={{ width: 22, height: 22, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />;

export function Home({ live, setup, setSetup, onWatch, onStart, onFocusKey, note, paired }: {
  live: Live;
  /** a run this TV is following, if any */
  paired: Paired | null;
  setup: Setup;
  setSetup: (s: Setup) => void;
  onWatch: () => void;
  onStart: () => void;
  onFocusKey: (k: string) => void;
  note: string | null;
}) {
  const left = useCountdown(live);
  const perRound = setup.amount / setup.rounds;
  const set = (amount: number) => setSetup({ ...setup, amount: Math.min(SOL_CAP, Math.round(amount * 1000) / 1000) });
  return (
    <View style={{ flex: 1 }}>
      <Wallpaper />
      <Safe>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand />
          <Pill dot={paired ? C.skr : C.teal}>{paired ? 'SEEKER PAIRED · AUTOPILOT ON' : 'NOT PAIRED · NO WALLET ON THIS TV'}</Pill>
        </View>
        <View style={{ flexDirection: 'row', gap: 28, marginTop: 20 }}>
          <Panel style={{ width: 960, height: 560 }} pad={30}>
            <View style={{ flexDirection: 'row' }}>
              <Stat value={live.round ? live.round.total.toFixed(1) : '--'} label="SOL deployed" icon={<Gem color={C.teal} />} />
              <Stat value={live.motherlode !== null ? live.motherlode.toFixed(1) : '--'} label="Motherlode" color={C.gold} icon={<Gem color={C.teal} />} />
              <Stat value={live.clock ? (live.clock.phase === 'mining' ? mmss(left) : '00:00') : '--'} label="Time left" />
            </View>
            <View style={{ height: 140, marginTop: 16, backgroundColor: C.well, borderWidth: 4, borderColor: '#1e2c5c', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 22 }}>
              <Gem color={C.teal} />
              <T font="display" size={110} color={C.text}>
                {solStr(setup.amount)}
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 16, height: 64 }}>
              <Btn label="-0.01" size={28} style={{ flex: 1 }} onFocus={() => onFocusKey('amount')} onPress={() => set(Math.max(0.001, setup.amount - 0.01))} />
              {[0.01, 0.1, 1].map((v) => (
                <Btn key={v} label={`+${v}`} size={28} style={{ flex: 1 }} onFocus={() => onFocusKey('amount')} onPress={() => set(setup.amount + v)} />
              ))}
              <Btn label="MAX" size={28} style={{ flex: 1 }} onFocus={() => onFocusKey('amount')} onPress={() => set(SOL_CAP)} />
            </View>
            <RoundsRow rounds={setup.rounds} onFocus={() => onFocusKey('rounds')} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 4, borderTopColor: C.bevelLo, paddingTop: 10 }}>
              <Label size={15}>Per round</Label>
              <T font="display" size={30}>
                {solStr(perRound)}
              </T>
            </View>
          </Panel>
          <View style={{ flex: 1 }}>
            <Panel style={{ height: 560 }} pad={30}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Label color={C.text}>The board</Label>
                <Label color={C.skr} size={13}>
                  Covers all 25 spots
                </Label>
              </View>
              <View style={{ marginTop: 14, alignItems: 'center' }}>
                <Board cells={Array(25).fill('covered')} size={80} gap={6} />
              </View>
            </Panel>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 28, gap: 28 }}>
          <Btn tone="skr" label={paired ? 'BACK TO MY RUN' : 'START MINING'} size={44} style={{ width: 960, height: 80 }} hasTVPreferredFocus onFocus={() => onFocusKey('start')} onPress={onStart} />
          <Btn tone="dark" label="WATCH LIVE BOARD" size={32} style={{ width: 340, height: 80 }} onFocus={() => onFocusKey('watch')} onPress={onWatch} />
          <View style={{ flex: 1 }}>
            {note ? (
              <T font="tiny" size={14} color={C.gold} style={{ letterSpacing: 2 }}>
                {note}
              </T>
            ) : (
              <T font="tiny" size={14} color={C.dim} style={{ letterSpacing: 2 }}>
                {live.error ? 'RPC UNREACHABLE · RETRYING' : `ROUND ${live.clock ? Number(live.clock.roundId) : '--'}`}
              </T>
            )}
          </View>
        </View>
        <View style={{ marginTop: 22 }}>
        <KeyHints hints={[{ key: 'ARROWS', text: 'MOVE' }, { key: 'LEFT RIGHT', text: 'CHANGE' }, { key: 'OK', text: 'PRESS' }, { key: 'PLAY', text: 'WATCH', hot: true }, { key: 'RIGHT', text: 'STATS' }]} />
        </View>
      </Safe>
      <Rail />
    </View>
  );
}

/** Rounds: focus it and press Left/Right (handled in TvApp) to change. */
function RoundsRow({ rounds, onFocus }: { rounds: number; onFocus: () => void }) {
  return (
    <Btn tone="dark" style={{ height: 60, marginTop: 16 }} onFocus={onFocus} focusGap={6} lockHorizontal>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22 }}>
        <Label size={15}>Rounds</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <T font="display" size={32} color={C.gold}>
            ◀
          </T>
          <T font="display" size={44}>
            {rounds}
          </T>
          <T font="display" size={32} color={C.gold}>
            ▶
          </T>
        </View>
      </View>
    </Btn>
  );
}

/** The miners' band along the bottom, with the cart on the right. */
function Rail({ status = 'READY TO MINE · PRESS PLAY', pose = 'idle', count = 1, statusTop = 40 }: { status?: string; pose?: 'swing' | 'cheer' | 'idle'; count?: 1 | 3; statusTop?: number }) {
  const looks = ['a', 'b', 'c'] as const;
  const xs = count === 3 ? [260, 860, 1450] : [260];
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 220, backgroundColor: '#161026', borderTopWidth: 6, borderTopColor: '#05060f' }}>
      <T font="tiny" size={20} color={C.gold} style={{ position: 'absolute', top: statusTop, width: '100%', textAlign: 'center', letterSpacing: 6 }}>
        {status}
      </T>
      {xs.map((x, i) => (
        <Miner key={i} look={looks[i]} pose={pose} offset={i * 2} style={{ position: 'absolute', left: x - 60, bottom: 14 }} />
      ))}
      <Sprite name="prop-rock-a-0" style={{ position: 'absolute', left: 560, bottom: 16 }} />
      <Sprite name="prop-stone-a-0" style={{ position: 'absolute', left: 760, bottom: 16 }} />
      <Sprite name="prop-rock-b-0" style={{ position: 'absolute', left: 1180, bottom: 16 }} />
      <Sprite name="ui-cart" style={{ position: 'absolute', right: 180, bottom: 16 }} />
    </View>
  );
}

/* ---------------- Mining (watch mode) and the Strike band ---------------- */

export function Mining({ live, paired, play, stopOpen, onCloseStop }: { live: Live; paired?: Paired | null; play?: PlayState | null; stopOpen?: boolean; onCloseStop?: () => void }) {
  const left = useCountdown(live);
  const clock = live.clock;
  const round = live.round;
  const id = clock ? Number(clock.roundId) : null;
  const [strike, setStrike] = useState<{ round: number; spot: number | null; sol: number; ore: number } | null>(null);
  const seen = useRef<number | null>(null);

  // Watch mode: when the round id moves on, the one before it has been drawn: show its result for a few seconds.
  // Play mode reports the owner's own result instead (below).
  useEffect(() => {
    if (id === null || paired) return;
    const prev = seen.current;
    seen.current = id;
    if (prev === null || prev === id) return;
    let dead = false;
    void fetchBoardRound(prev).then((r) => {
      if (dead || !r || !r.settled) return;
      setStrike({ round: prev, spot: r.winning === null ? null : r.winning + 1, sol: r.total, ore: r.oreReward });
      setTimeout(() => !dead && setStrike(null), 9000);
    });
    return () => {
      dead = true;
    };
  }, [id, paired]);

  // Play mode: the owner's result for each settled round, for nine seconds
  const [mine, setMine] = useState<PlayState['result']>(null);
  const lastResult = play?.result?.at;
  useEffect(() => {
    if (!play?.result) return;
    setMine(play.result);
    const t = setTimeout(() => setMine(null), 9000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResult]);
  const per = paired ? runCost(paired.lpr, paired.rounds) : null;

  const cells = useMemo(() => {
    const per = round?.perSquare ?? Array(25).fill(0);
    const avg = per.reduce((a, b) => a + b, 0) / 25;
    // brighter than average = hot; some SOL = covered; none = empty
    return per.map((v) => (v > 0 && v >= avg * 1.15 ? 'hot' : v > 0 ? 'covered' : 'empty')) as ('empty' | 'covered' | 'hot')[];
  }, [round]);
  // elapsed share of the mining window, advanced locally between polls
  const span = clock && clock.phase === 'mining' ? Math.max(1, Number(clock.endSlot - clock.startSlot) * 400) : 0;
  const progress = span ? Math.max(0, Math.min(1, 1 - left / span)) : 0;
  const waiting = clock?.phase === 'waiting';
  const drawing = clock?.phase === 'intermission';

  return (
    <View style={{ flex: 1 }}>
      <Wallpaper dim={0.55} />
      <FocusSink />
      <Safe>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand />
          <Pill dot={live.error ? C.red : C.skr}>
            {paired ? (play?.status === 'finished' ? `RUN FINISHED · ROUND ${id ?? '--'}` : `SEEKER PAIRED · AUTOPILOT ON · ROUND ${id ?? '--'}`) : `WATCHING LIVE · ROUND ${id ?? '--'}`}
          </Pill>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <View style={{ width: 1000 }}>
            <Label size={18} color={C.text}>
              {waiting ? 'Waiting for the first deploy' : drawing ? 'Drawing the strike' : 'Strike in'}
            </Label>
            <T font="display" size={230} color={C.gold} style={{ marginTop: -6, lineHeight: 240 }}>
              {clock ? (clock.phase === 'mining' ? mmss(left) : '00:00') : '--:--'}
            </T>
            <View style={{ marginTop: 6 }}>
              <Segments value={drawing ? 1 : progress} />
            </View>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 16 }}>
              <StatBox label="Total deployed" value={round ? round.total.toFixed(3) : '--'} />
              {paired && per ? (
                <StatBox label={`Your deploy · ${play?.roundsLeft ?? '--'} left`} value={fmtSol(per.perRound)} color={C.skr} />
              ) : (
                <StatBox label="Miners in round" value={round ? String(round.miners) : '--'} />
              )}
              <StatBox label="Motherlode" value={live.motherlode !== null ? live.motherlode.toFixed(1) : '--'} color={C.gold} />
            </View>
          </View>
          <Panel style={{ width: 700, height: 660, marginLeft: 30, marginTop: 20 }} pad={24}>
            <Label color={C.text} size={14}>
              {drawing ? 'Drawing the strike' : 'Where the SOL is'}
            </Label>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              <Board cells={cells} size={104} gap={8} />
            </View>
          </Panel>
        </View>
      </Safe>
      <View style={{ position: 'absolute', left: SAFE_X, bottom: 232 }}>
        <KeyHints hints={paired ? [{ key: 'BACK', text: 'STOP AUTOPILOT' }, { key: 'LEFT', text: 'HOME' }, { key: 'RIGHT', text: 'STATS' }] : [{ key: 'BACK', text: 'HOME' }, { key: 'LEFT', text: 'HOME' }, { key: 'RIGHT', text: 'STATS' }]} />
      </View>
      <Rail
        status={strike || mine ? '' : play?.status === 'finished' ? 'RUN FINISHED · PRESS START MINING FOR A NEW ONE' : play?.error ? `TV DEPLOY: ${play.error.toUpperCase()}` : drawing ? 'THE DRILLS ARE DOWN...' : 'MINING...'}
        pose={play?.status === 'finished' ? 'idle' : 'swing'}
        count={3}
        statusTop={-48}
      />
      {strike && <StrikeBand strike={strike} />}
      {mine && <MyResultBand result={mine} live={live} left={play?.roundsLeft ?? null} rounds={paired?.rounds ?? 0} />}
      {stopOpen && paired && <StopOverlay owner={paired.owner} onClose={() => onCloseStop?.()} />}
    </View>
  );
}

/** Play mode: the owner's own round. A hit (they were on the winning spot) is the Strike screen; anything else a short band. */
function MyResultBand({ result, live, left, rounds }: { result: NonNullable<PlayState['result']>; live: Live; left: number | null; rounds: number }) {
  const next = useCountdown(live);
  if (!result.hit)
    return (
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 160, backgroundColor: '#140c28', borderTopWidth: 6, borderTopColor: C.steelHi, alignItems: 'center', justifyContent: 'center' }}>
        <T font="display" size={52} color={C.text} style={{ letterSpacing: 4 }}>
          NO STRIKE THIS ROUND
        </T>
        <Label size={14} style={{ marginTop: 8 }}>{`Round ${result.round} · keep going`}</Label>
      </View>
    );
  const cells = Array.from({ length: 25 }, (_, i) => (result.spot === i + 1 ? 'win' : 'empty')) as ('win' | 'empty')[];
  return (
    <View style={{ ...absFill, backgroundColor: 'rgba(4,6,15,0.55)', alignItems: 'center', paddingTop: 70 }}>
      <Panel style={{ width: 1000, height: 620 }} pad={36}>
        <View style={{ alignItems: 'center' }}>
          <T font="display" size={150} color={C.gold} style={{ lineHeight: 156 }}>
            STRIKE!
          </T>
          <Label size={18} color={C.text} style={{ letterSpacing: 8 }}>
            {`Spot ${result.spot} hit · you were on it`}
          </Label>
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 26 }}>
            <View style={{ backgroundColor: C.skr, borderWidth: 4, borderColor: '#e6ffb0', borderBottomColor: C.skrDark, borderRightColor: C.skrDark, paddingHorizontal: 30, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <T font="display" size={52} color="#16300a">{`+${fmtSol(result.sol) || '0'} SOL`}</T>
            </View>
            <View style={{ backgroundColor: C.gold, borderWidth: 4, borderColor: '#fff1a6', borderBottomColor: C.goldDark, borderRightColor: C.goldDark, paddingHorizontal: 30, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Gem color={C.teal} />
              <T font="display" size={52} color="#3a1800">{`+${result.ore.toFixed(result.ore < 1 ? 3 : 2)} ORE`}</T>
            </View>
          </View>
          <View style={{ marginTop: 24 }}>
            <Board cells={cells} size={40} gap={4} labels={false} />
          </View>
          <Label size={14} style={{ marginTop: 18 }}>
            {`Next round in ${mmss(next)}${left !== null ? ` · ${left} of ${rounds} left` : ''}`}
          </Label>
        </View>
      </Panel>
      <View style={{ position: 'absolute', left: 220, bottom: 14 }}>
        <Miner look="a" pose="cheer" />
      </View>
      <View style={{ position: 'absolute', left: 860, bottom: 14 }}>
        <Miner look="b" pose="cheer" offset={1} />
      </View>
      <View style={{ position: 'absolute', right: 300, bottom: 14 }}>
        <Miner look="c" pose="cheer" offset={2} />
      </View>
    </View>
  );
}

const StatBox = ({ label, value, color = C.text }: { label: string; value: string; color?: string }) => (
  <Panel style={{ flex: 1, height: 130 }} pad={22}>
    <Label size={13}>{label}</Label>
    <T font="display" size={52} color={color} style={{ marginTop: 6 }}>
      {value}
    </T>
  </Panel>
);

/** Shown for a few seconds after a round is drawn. Watch mode has no "your" strike, so it reports the round itself. */
function StrikeBand({ strike }: { strike: { round: number; spot: number | null; sol: number; ore: number } }) {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 250, backgroundColor: '#140c28', borderTopWidth: 6, borderTopColor: C.gold, alignItems: 'center', justifyContent: 'center' }}>
      <T font="display" size={64} color={C.gold} style={{ letterSpacing: 4 }}>
        {strike.spot ? `STRIKE · SPOT ${strike.spot}` : 'ROUND DRAWN'}
      </T>
      <T font="tiny" size={20} color={C.text} style={{ letterSpacing: 4, marginTop: 12 }}>
        {`ROUND ${strike.round} · ${strike.sol.toFixed(2)} SOL ON THE BOARD · ${strike.ore.toFixed(2)} ORE MINED`}
      </T>
      <View style={{ position: 'absolute', left: 220, bottom: 14 }}>
        <Miner look="a" pose="cheer" />
      </View>
      <View style={{ position: 'absolute', right: 220, bottom: 14 }}>
        <Miner look="b" pose="cheer" offset={1} />
      </View>
    </View>
  );
}

/* ---------------- Stats ---------------- */

const Tile = ({ icon, label, value, fill, hi, lo, big }: { icon: string; label: string; value: string; fill: string; hi: string; lo: string; big?: boolean }) => (
  <Panel style={{ flex: 1, height: 190 }} fill={fill} hi={hi} lo={lo} pad={26}>
    <Label size={14} color={C.text}>
      {`${icon}  ${label}`}
    </Label>
    <T font="display" size={big ? 84 : 76} color={C.text} style={{ marginTop: 14 }}>
      {value}
    </T>
  </Panel>
);

const Mini = ({ dot, label, value }: { dot: string; label: string; value: string }) => (
  <Panel style={{ flex: 1, height: 130 }} pad={22}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 14, height: 14, backgroundColor: dot }} />
      <Label size={13}>{label}</Label>
    </View>
    <T font="display" size={52} style={{ marginTop: 8 }}>
      {value}
    </T>
  </Panel>
);

const num = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '--' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));

export function Stats({ live }: { live: Live }) {
  const left = useCountdown(live);
  const comm = useCommunity(true);
  const last = live.last;
  const lastCells = (last ? Array.from({ length: 25 }, (_, i) => (last.winning === i ? 'win' : 'empty')) : Array(25).fill('empty')) as ('win' | 'empty')[];
  return (
    <View style={{ flex: 1 }}>
      <Wallpaper dim={0.4} />
      <FocusSink />
      <Safe>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand title="GALI LIVE" />
          <Pill dot={C.red}>{`LIVE · ROUND ${live.clock ? Number(live.clock.roundId) : '--'}`}</Pill>
        </View>
        <Label style={{ marginTop: 14 }}>This round</Label>
        <View style={{ flexDirection: 'row', gap: 22, marginTop: 8 }}>
          <Tile icon="◷" label="Strike in" value={live.clock?.phase === 'mining' ? mmss(left) : '--:--'} fill="#2e4d94" hi="#5f86d8" lo="#1b2f63" />
          <Tile icon="◆" label="SOL deployed" value={live.round ? live.round.total.toFixed(1) : '--'} fill="#1b8ea3" hi="#5fdcef" lo="#0f5e70" />
          <Tile icon="⛏" label="Miners in round" value={live.round ? String(live.round.miners) : '--'} fill="#7b2d63" hi="#c45da4" lo="#4d1a3d" />
          <Tile icon="◆" label="Motherlode" value={live.motherlode !== null ? live.motherlode.toFixed(1) : '--'} fill="#c97814" hi="#ffc36a" lo="#8a4d0a" />
        </View>
        <Label style={{ marginTop: 18 }}>Gali community</Label>
        <View style={{ flexDirection: 'row', gap: 22, marginTop: 8 }}>
          <Mini dot={C.skr} label="Online now" value={num(comm?.online)} />
          <Mini dot={C.teal} label="Registered" value={num(comm?.registered)} />
          <Mini dot={C.pink} label="New today" value={num(comm?.newToday)} />
          <Mini dot={C.gold} label="Gali ORE mined" value={num(comm?.oreMined, 1)} />
        </View>
        {comm?.problem && (
          <T font="tiny" size={13} color={C.gold} style={{ marginTop: 8, letterSpacing: 2 }}>
            {comm.problem.toUpperCase()}
          </T>
        )}
        <View style={{ flexDirection: 'row', gap: 22, marginTop: 18 }}>
          <Panel style={{ width: 640, height: 300 }} pad={26}>
            <Label size={13}>Last round</Label>
            <View style={{ flexDirection: 'row', gap: 26, marginTop: 16, alignItems: 'center' }}>
              <Board cells={lastCells} size={36} gap={4} labels={false} />
              <View>
                <T font="display" size={50} color={C.gold}>
                  {last ? (last.winning !== null ? `SPOT ${last.winning + 1}` : 'NO DRAW') : '--'}
                </T>
                <T font="body" size={20} style={{ marginTop: 6 }}>
                  {last ? (last.split ? 'SPLIT' : last.winner ? `${last.winner.slice(0, 4)}..${last.winner.slice(-4)}` : `ROUND ${last.roundId}`) : ''}
                </T>
                <Label size={12}>{last ? `${last.total.toFixed(2)} SOL · ${last.oreReward.toFixed(2)} ORE` : ''}</Label>
              </View>
            </View>
          </Panel>
          <Panel style={{ flex: 1, height: 300 }} pad={26}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Label size={13}>Top miners (ORE mined)</Label>
              <Label size={13}>ORE</Label>
            </View>
            {Array.from({ length: 5 }, (_, i) => {
              const m = comm?.top[i];
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', height: 44, marginTop: i ? 4 : 10, backgroundColor: i % 2 ? 'transparent' : '#101a40', paddingHorizontal: 8 }}>
                  <View style={{ width: 30, height: 30, backgroundColor: [C.gold, '#e0e6ff', C.goldDark, C.steelHi, C.steelHi][i], alignItems: 'center', justifyContent: 'center' }}>
                    <T font="display" size={22} color="#1a1200">
                      {i + 1}
                    </T>
                  </View>
                  <T font="body" size={22} style={{ flex: 1, marginLeft: 18 }} numberOfLines={1}>
                    {m ? m.name.toUpperCase() : '--'}
                  </T>
                  <T font="display" size={28} color={C.skr}>
                    {m ? num(m.ore, 2) : '--'}
                  </T>
                </View>
              );
            })}
          </Panel>
        </View>
        <View style={{ flex: 1 }} />
        <KeyHints hints={[{ key: 'LEFT', text: 'HOME' }, { key: 'BACK', text: 'HOME' }, { key: 'PLAY', text: 'WATCH', hot: true }]} />
      </Safe>
    </View>
  );
}

/* ---------------- Pair (stage 2) ---------------- */

const fmtSol = (n: number) => (n >= 1 ? n.toFixed(3) : n >= 0.01 ? n.toFixed(4) : n.toFixed(5)).replace(/0+$/, '').replace(/\.$/, '');

/** What the phone will be asked to approve, in SOL: the rounds, the executor fee on each, and the TV's fee float. */
export function runCost(lpr: number, rounds: number) {
  const perSpot = perSpotLamports(lpr) / 1e9;
  const perRound = perSpot * TV_SPOTS;
  const fee = 0.00001;
  return { perSpot, perRound, fee, total: (perRound + fee) * rounds };
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
    <T font="body" size={22} color={C.text}>
      {k}
    </T>
    <T font="body" size={22} color={C.text}>
      {v}
    </T>
  </View>
);

const Step = ({ n, text }: { n: number; text: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 14 }}>
    <View style={{ width: 50, height: 50, backgroundColor: C.steel, borderWidth: 4, borderColor: C.steelHi, alignItems: 'center', justifyContent: 'center' }}>
      <T font="display" size={36}>
        {n}
      </T>
    </View>
    <T font="body" size={27} color={C.text}>
      {text}
    </T>
  </View>
);

/** Shown when START MINING is pressed and this TV has no run: a QR and code for the Seeker, then a check on chain. */
export function Pair({ lpr, rounds, onPaired }: { lpr: number; rounds: number; onPaired: (p: Paired) => void }) {
  const { req, status, error, renew } = usePairing(lpr, rounds, onPaired);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const cost = runCost(lpr, rounds);
  const left = req ? Math.max(0, req.exp - now) : 0;
  const expired = status === 'expired' || (req !== null && left === 0);
  const line =
    status === 'error' ? `CAN'T REACH THE PAIRING SERVER · ${(error ?? '').toUpperCase()}`
    : expired ? 'CODE EXPIRED · PRESS OK FOR A NEW ONE'
    : status === 'checking' ? 'APPROVED ON YOUR SEEKER · CHECKING THE CHAIN...'
    : error ? error.toUpperCase()
    : 'WAITING FOR YOUR SEEKER...';
  return (
    <View style={{ flex: 1 }}>
      <Wallpaper dim={0.35} />
      <Safe>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand />
          <Pill dot={C.steelHi}>NOT PAIRED</Pill>
        </View>
        <Panel style={{ marginTop: 22, height: 740 }} pad={36}>
          <View style={{ flexDirection: 'row', gap: 56 }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ padding: 18 }}>
                <View style={{ opacity: expired ? 0.15 : 1 }}>{req ? <Qr value={pairUrl(req)} size={440} /> : <View style={{ width: 440, height: 440, backgroundColor: '#f4f6ff' }} />}</View>
                <CornerMarks />
              </View>
              <Label size={15} style={{ marginTop: 10 }}>
                {"Can't scan? Enter this code"}
              </Label>
              <View style={{ marginTop: 12, backgroundColor: C.well, borderWidth: 4, borderColor: '#1e2c5c', paddingHorizontal: 28, paddingVertical: 6 }}>
                <T font="display" size={60} color={C.gold} style={{ letterSpacing: 8 }}>
                  {req ? prettyCode(req.code) : '----'}
                </T>
              </View>
              <Label size={14} style={{ marginTop: 10 }}>
                {expired ? 'Expired' : `Expires in ${mmss(left)}`}
              </Label>
            </View>
            <View style={{ flex: 1 }}>
              <T font="display" size={76} color={C.gold} style={{ lineHeight: 80 }}>
                {'SCAN WITH\nYOUR SEEKER'}
              </T>
              <Step n={1} text="Open your Seeker's camera, or Gali > Scan TV" />
              <Step n={2} text="Point it at this code" />
              <Step n={3} text="Tap Approve in your wallet" />
              <View style={{ marginTop: 22, backgroundColor: C.well, borderWidth: 4, borderColor: '#1e2c5c', paddingHorizontal: 26, paddingVertical: 18 }}>
                <Label size={14}>{"You're approving"}</Label>
                <Row k="Amount" v={`${fmtSol(cost.perRound * rounds)} SOL`} />
                <Row k="Rounds" v={`${rounds} × ${fmtSol(cost.perRound)} SOL`} />
                <Row k="Spots" v="All 25" />
                <Row k="Network fee" v={`${fmtSol(cost.fee)} SOL / round`} />
                <Row k="Gali fee (0.25%)" v={`${fmtSol(cost.perRound * rounds * 0.0025)} SOL`} />
                <Label size={13} color={C.skr} style={{ marginTop: 16 }}>
                  {"This TV can only deploy. It can't move your SOL."}
                </Label>
              </View>
            </View>
          </View>
        </Panel>
        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ width: 22, height: 22, backgroundColor: expired || status === 'error' ? C.red : status === 'checking' ? C.gold : C.teal }} />
            <T font="tiny" size={22} color={C.text} style={{ letterSpacing: 6 }}>
              {line}
            </T>
          </View>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
          <Btn tone="dark" label="NEW CODE" size={26} style={{ width: 260, height: 64 }} hasTVPreferredFocus onPress={renew} />
          <KeyHints hints={[{ key: 'OK', text: 'NEW CODE' }, { key: 'BACK', text: 'CANCEL' }]} />
        </View>
      </Safe>
    </View>
  );
}

/** Gold corner brackets around the QR, as in the reference. */
function CornerMarks() {
  const arm = { position: 'absolute' as const, backgroundColor: C.gold };
  const L = 56;
  const W = 10;
  return (
    <View pointerEvents="none" style={absFill}>
      <View style={[arm, { top: 0, left: 0, width: L, height: W }]} />
      <View style={[arm, { top: 0, left: 0, width: W, height: L }]} />
      <View style={[arm, { top: 0, right: 0, width: L, height: W }]} />
      <View style={[arm, { top: 0, right: 0, width: W, height: L }]} />
      <View style={[arm, { bottom: 0, left: 0, width: L, height: W }]} />
      <View style={[arm, { bottom: 0, left: 0, width: W, height: L }]} />
      <View style={[arm, { bottom: 0, right: 0, width: L, height: W }]} />
      <View style={[arm, { bottom: 0, right: 0, width: W, height: L }]} />
    </View>
  );
}

/* ---------------- Paired ---------------- */

const Box = ({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) => (
  <View style={{ flex: 1, backgroundColor: C.well, borderWidth: 4, borderColor: '#1e2c5c', paddingHorizontal: 22, paddingVertical: 14 }}>
    <Label size={12}>{label}</Label>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
      {icon}
      <T font="display" size={50}>
        {value}
      </T>
    </View>
  </View>
);

/** The chain confirmed the run. Moves on to Mining by itself after a few seconds, or on OK. */
export function PairedScreen({ paired, live, onGo }: { paired: Paired; live: Live; onGo: () => void }) {
  const left = useCountdown(live);
  const cost = runCost(paired.lpr, paired.rounds);
  useEffect(() => {
    const id = setTimeout(onGo, 8000);
    return () => clearTimeout(id);
  }, [onGo]);
  return (
    <View style={{ flex: 1 }}>
      <Wallpaper dim={0.45} />
      <Safe>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand />
          <Pill dot={C.skr}>SEEKER PAIRED · AUTOPILOT ON</Pill>
        </View>
        <View style={{ alignItems: 'center', marginTop: 20 }}>
          <Panel style={{ width: 1100, height: 520 }} pad={40}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
                <View style={{ width: 120, height: 120, backgroundColor: C.skr, borderWidth: 6, borderColor: '#e6ffb0', borderBottomColor: C.skrDark, borderRightColor: C.skrDark, alignItems: 'center', justifyContent: 'center' }}>
                  <T font="display" size={96} color="#16300a">
                    ✓
                  </T>
                </View>
                <T font="display" size={150} color={C.skr} style={{ lineHeight: 160 }}>
                  PAIRED!
                </T>
              </View>
              <Label size={18} color={C.text} style={{ marginTop: 18, letterSpacing: 8 }}>
                Your Seeker approved the autopilot
              </Label>
            </View>
            <View style={{ flexDirection: 'row', gap: 20, marginTop: 30 }}>
              <Box label="Funded" value={fmtSol(cost.total)} icon={<Gem color={C.teal} />} />
              <Box label="Rounds" value={`${paired.rounds} × ${fmtSol(cost.perRound)}`} />
              <Box label="Spots" value="ALL 25" />
            </View>
            <Label size={13} style={{ marginTop: 22, textAlign: 'center' }}>
              Stop anytime: Back on the TV, then scan · unused SOL comes back
            </Label>
            <T font="tiny" size={22} color={C.gold} style={{ marginTop: 16, textAlign: 'center', letterSpacing: 6 }}>
              {live.clock?.phase === 'mining' ? `NEXT ROUND IN ${mmss(left)}` : 'FIRST ROUND STARTING...'}
            </T>
          </Panel>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28, marginBottom: 230 }}>
          <Btn tone="skr" label="START" size={26} style={{ width: 220, height: 60 }} hasTVPreferredFocus onPress={onGo} />
          <KeyHints hints={[{ key: 'OK', text: 'TO THE BOARD' }]} />
        </View>
      </Safe>
      <Rail status="" pose="cheer" count={3} />
    </View>
  );
}

/* ---------------- Stop on your Seeker ---------------- */

/** Back on Mining while paired: the TV can't stop a run (only the wallet can), so it hands over a QR. */
export function StopOverlay({ owner, onClose }: { owner: string; onClose: () => void }) {
  return (
    <View style={{ ...absFill, backgroundColor: 'rgba(4,6,15,0.82)', alignItems: 'center', justifyContent: 'center' }}>
      <Panel style={{ width: 1180, height: 640 }} pad={44}>
        <View style={{ flexDirection: 'row', gap: 50, alignItems: 'center' }}>
          <Qr value={stopUrl(owner)} size={460} />
          <View style={{ flex: 1 }}>
            <T font="display" size={80} color={C.gold} style={{ lineHeight: 84 }}>
              {'STOP ON\nYOUR SEEKER'}
            </T>
            <T font="body" size={26} color={C.text} style={{ marginTop: 20, lineHeight: 36 }}>
              Scan this with your Seeker and approve in your wallet. ORE closes the autopilot and sends the unused SOL back
              to your wallet.
            </T>
            <Label size={13} style={{ marginTop: 18 }}>
              Keeping it on? The autopilot carries on with the TV off.
            </Label>
            <View style={{ flexDirection: 'row', gap: 20, marginTop: 30 }}>
              <Btn tone="dark" label="KEEP MINING" size={24} style={{ width: 260, height: 60 }} hasTVPreferredFocus onPress={onClose} />
            </View>
          </View>
        </View>
      </Panel>
    </View>
  );
}
