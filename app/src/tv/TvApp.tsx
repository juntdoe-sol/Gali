/**
 * The TV app's root: loads the fonts, runs the splash, and moves between Home, Mining and Stats with the remote.
 *
 * Remote: arrows move focus, OK presses, Play/Pause opens the live board, Back goes back (and exits from Home).
 * Left/Right on the Rounds row changes the round count; Right from the bottom row of Home opens Stats.
 * Stage 1 is watch mode. Stage 2 adds play mode: START MINING pairs with a Seeker (Pair -> Paired), and while a run
 * is paired the TV follows it on every screen (usePlay); Back on Mining offers "Stop on your Seeker".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, View, useTVEventHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Jersey15_400Regular } from '@expo-google-fonts/jersey-15';
import { PixelifySans_400Regular, PixelifySans_600SemiBold } from '@expo-google-fonts/pixelify-sans';
import { Silkscreen_400Regular } from '@expo-google-fonts/silkscreen';
import { useFonts } from 'expo-font';
import { useLive } from './data';
import { perSpotLamports, TV_SPOTS } from './link';
import { checkRun, clearPaired, loadPaired, usePlay, type Paired } from './play';
import { Home, Mining, Pair, PairedScreen, Splash, Stats, type Setup } from './screens';
import { C } from './theme';

type Screen = 'splash' | 'home' | 'mining' | 'stats' | 'pair' | 'paired';
/** The phone app's floor (MIN_SOL_PER_BLOCK) and autopilot cap (LIVE_AUTOPILOT_MAX_SOL). */
const MIN_PER_SPOT = 0.0001;
const MAX_RUN_SOL = 1;
const ROUND_CHOICES = [1, 2, 5, 10, 25, 50, 100];

export default function TvApp() {
  const [fontsOk] = useFonts({ Jersey15_400Regular, PixelifySans_400Regular, PixelifySans_600SemiBold, Silkscreen_400Regular });
  const [screen, setScreen] = useState<Screen>('splash');
  const [setup, setSetup] = useState<Setup>({ amount: 0.025, rounds: 10 });
  const [paired, setPaired] = useState<Paired | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const stopRef = useRef(false);
  stopRef.current = stopOpen;
  const [note, setNote] = useState<string | null>(null);
  const focusKey = useRef('start');
  const screenRef = useRef<Screen>('splash');
  screenRef.current = screen;

  // Polls only while a screen that shows the live round is up.
  const live = useLive(screen !== 'splash');
  const play = usePlay(paired, live);
  // A run paired before the app was closed: pick it up again if ORE still holds it
  useEffect(() => {
    void loadPaired().then(async (p) => {
      if (!p) return;
      const c = await checkRun(p.owner, p.lpr, p.rounds).catch(() => null);
      if (c?.ok) setPaired(p);
      else if (c) await clearPaired();
    });
  }, []);
  const running = paired && play.status !== 'finished' ? paired : null;
  const pairedRef = useRef<Paired | null>(null);
  pairedRef.current = running;

  // The run START MINING would ask the Seeker for: lamports per round across all 25 spots, within the phone's limits.
  const lpr = Math.floor((setup.amount / setup.rounds) * 1e9);
  const startMining = () => {
    if (running) return go('mining');
    const perSpot = perSpotLamports(lpr) / 1e9;
    if (perSpot < MIN_PER_SPOT) return setNote(`AT LEAST ${(MIN_PER_SPOT * TV_SPOTS).toFixed(4)} SOL PER ROUND (${MIN_PER_SPOT} PER SPOT)`);
    if ((perSpot * TV_SPOTS + 0.00001) * setup.rounds > MAX_RUN_SOL) return setNote(`AUTOPILOT IS CAPPED AT ${MAX_RUN_SOL} SOL · LOWER THE AMOUNT`);
    go('pair');
  };

  const go = useCallback((s: Screen) => {
    setNote(null);
    setStopOpen(false);
    setScreen(s);
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = screenRef.current;
      if (s === 'mining' && pairedRef.current) {
        // paired: Back offers "Stop on your Seeker"; Back again closes it
        setStopOpen((o) => !o);
        return true;
      }
      if (s === 'paired') {
        go('mining');
        return true;
      }
      if (s === 'mining' || s === 'stats' || s === 'pair') {
        go('home');
        return true;
      }
      return false; // Home and Splash: let Android close the app
    });
    return () => sub.remove();
  }, [go]);

  useTVEventHandler((e) => {
    // This platform delivers the key-up half of each press to the handler (eventKeyAction 1); ignore any key-down.
    if (e.eventKeyAction === 0) return;
    const s = screenRef.current;
    const k = e.eventType;
    if (stopRef.current) return; // the stop sheet has its own button
    if (k === 'playPause' && (s === 'home' || s === 'stats')) go('mining');
    else if (s === 'home' && focusKey.current === 'rounds' && (k === 'left' || k === 'right')) {
      setSetup((p) => {
        const i = Math.max(0, ROUND_CHOICES.indexOf(p.rounds));
        return { ...p, rounds: ROUND_CHOICES[Math.max(0, Math.min(ROUND_CHOICES.length - 1, i + (k === 'right' ? 1 : -1)))] };
      });
    } else if (s === 'home' && k === 'right' && (focusKey.current === 'start' || focusKey.current === 'watch')) go('stats');
    else if ((s === 'stats' || s === 'mining') && k === 'left') go(s === 'stats' ? 'home' : 'home');
    else if (s === 'mining' && k === 'right') go('stats');
  });

  // Every screen is laid out on a fixed 1920x1080 canvas. The Xiaomi's window is 960x540 dp (density 2), so the canvas
  // is scaled to it: 0.5 maps the pre-scaled sprites back onto whole pixels.
  // Measured from the root view, not useWindowDimensions: with a resolution override (the Xiaomi runs a 4K panel at
  // 1080p) Dimensions still reports the physical panel.
  const [width, setWidth] = useState(960);
  const scale = width / 1920;
  if (!fontsOk) return <View style={{ flex: 1, backgroundColor: C.ocean }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.ocean, overflow: 'hidden' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <StatusBar hidden />
      <View style={{ width: 1920, height: 1080, transform: [{ scale }], transformOrigin: 'top left' }}>
      {screen === 'splash' && <Splash onDone={() => go('home')} />}
      {screen === 'home' && (
        <Home
          live={live}
          setup={setup}
          setSetup={setSetup}
          note={note}
          paired={running}
          onFocusKey={(k) => (focusKey.current = k)}
          onWatch={() => go('mining')}
          onStart={startMining}
        />
      )}
      {screen === 'pair' && (
        <Pair
          lpr={lpr}
          rounds={setup.rounds}
          onPaired={(p) => {
            setPaired(p);
            go('paired');
          }}
        />
      )}
      {screen === 'paired' && paired && <PairedScreen paired={paired} live={live} onGo={() => go('mining')} />}
      {screen === 'mining' && <Mining live={live} paired={paired} play={paired ? play : null} stopOpen={stopOpen} onCloseStop={() => setStopOpen(false)} />}
      {screen === 'stats' && <Stats live={live} />}
      </View>
    </View>
  );
}
