import { useBrawl, _test } from './game/brawl';
import { useAppFonts } from './fonts';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SidePanel } from './ui/Side';
import { useLayout } from './ui/layout';
import { TAB_KEY } from './ui/TabBar';
import { useView } from './pixel/view';
import { BLOCKS } from './game/constants';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from './game/constants';
import { oreLive } from './chain/light';
import { initAudio } from './game/sfx';
import { useGame } from './game/store';
import PixelMine from './pixel/PixelMine';
import { useWorld } from './game/world';
import { TabBar, type SheetTab } from './ui/TabBar';
import { Dock } from './ui/Dock';
import { RoundCard, Toasts, TopBar } from './ui/Hud';
import { Busy, GearReveal, LevelUp, LiveNotice, Onboarding, ResultPop, WalletGate, WalletPicker } from './ui/Modals';
import { Sheet } from './ui/Sheet';
import { ClaimPanel } from './ui/ClaimPanel';
import { MapHint } from './ui/MapHint';
import { Splash } from './ui/Splash';
import { PeerCard } from './ui/World';
import { CaveEntry, CaveScreen } from './ui/Cave';
import { LobbyBack, LobbyScreen, SharedChat } from './ui/Lobby';
import { useLobby } from './game/lobby';
import { useCave } from './game/caveStore';
import { useArcade } from './game/arcade';


// lets browser tests watch the game state
if (Platform.OS === 'web') Object.assign(globalThis, { __gali: useGame, __galiWorld: useWorld, __galiLobbyStore: useLobby, __galiCaveStore: useCave, __galiArcadeStore: useArcade, __galiBrawl: useBrawl, __galiBrawlTest: _test });
// pixel art in the interface (gear icons) stays crisp when the browser scales it
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('gali-pixel-css')) {
  const el = document.createElement('style');
  el.id = 'gali-pixel-css';
  el.textContent = '[data-pixelart], [data-pixelart] * { image-rendering: pixelated; image-rendering: crisp-edges; }';
  document.head.appendChild(el);
}

// expo-notifications stays out of the web startup bundle; loaded on first use.
let notificationsP: Promise<typeof import('expo-notifications')> | null = null;
const loadNotifications = () =>
  (notificationsP ??= import('expo-notifications').then((N) => {
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
    });
    return N;
  }));
if (Platform.OS !== 'web') void loadNotifications().catch(() => undefined);

async function scheduleDailyReminder() {
  try {
    const Notifications = await loadNotifications();
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: { title: '⛏ The mine is open', body: 'A new round every minute. Keep your streak alive and mine some ORE.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 9, minute: 0 },
    });
  } catch {
    /* notifications unavailable */
  }
}

export default function App() {
  const fontsLoaded = useAppFonts();
  const [sheet, setSheet] = useState<SheetTab | null>(null);
  const onboarded = useGame((s) => s.save.onboarded);

  useEffect(() => {
    // Web: sound files wait for the first touch (browsers won't play before one
    // anyway), so they don't compete with the island for the first download.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const unlock = () => {
        initAudio();
        window.removeEventListener('pointerdown', unlock, true);
      };
      window.addEventListener('pointerdown', unlock, true);
    } else initAudio();
    void useGame.getState().boot();
    const id = setInterval(() => useGame.getState().tick(), 100);
    // Back from a wallet approval or the home screen: re-read the live board and wallet at once.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useGame.getState().resumeLive();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (onboarded) void scheduleDailyReminder();
  }, [onboarded]);

  // The island draws straight away; the interface waits for its fonts.
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <PixelMine />
        {fontsLoaded ? <Ui sheet={sheet} setSheet={setSheet} /> : null}
        <Splash fontsLoaded={fontsLoaded} />
      </View>
    </SafeAreaProvider>
  );
}

/**
 * Keyboard shortcuts for a desktop browser. Letters open the pages (the rail shows each one's key),
 * C or Enter the chat, L the lobby, Esc closes whatever is on top. Inside a spot: A and D step
 * between spots and Space picks. Never a key that spends: deploying always takes a click and a
 * wallet approval. Keys typed into a text field are left alone, and so is WASD in the lobby.
 */
function useHotkeys(sheet: SheetTab | null, setSheet: (t: SheetTab | null) => void, on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const byKey = Object.fromEntries(Object.entries(TAB_KEY).map(([t, k]) => [k.toLowerCase(), t])) as Record<string, SheetTab | 'chat'>;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const L = useLobby.getState();
      const V = useView.getState();
      if (k === 'escape') {
        if (sheet) setSheet(null);
        else if (L.chatOpen) L.setChatOpen(false);
        else if (V.focus >= 0) V.go(-1);
        else window.dispatchEvent(new CustomEvent('gali:escape'));
        return;
      }
      // anything covering the game (a wallet prompt, a mini game) owns its own keys
      const st = useGame.getState();
      if (st.walletPicker || st.liveNotice || useCave.getState().open || useArcade.getState().game) return;
      if (k === 'enter' && !sheet) {
        L.setChatOpen(true);
        e.preventDefault();
        return;
      }
      if (k === '?' || (k === 'h' && L.where === 'island')) {
        window.dispatchEvent(new CustomEvent('gali:help'));
        return;
      }
      if (L.where === 'lobby') {
        if (k === 'g') window.dispatchEvent(new CustomEvent('gali:travel'));
        // WASD and the arrows walk you; the page letters still work
      } else if (V.focus >= 0) {
        if (k === 'a' || k === 'arrowleft') return V.go((V.focus + BLOCKS - 1) % BLOCKS);
        if (k === 'd' || k === 'arrowright') return V.go((V.focus + 1) % BLOCKS);
        if (k === ' ') {
          e.preventDefault();
          if (st.phase === 'mining' && !st.pending && !st.run) st.toggleBlock(V.focus);
          return;
        }
      } else if (k === 'l' && !sheet) {
        L.go('lobby', 'island');
        return;
      }
      const tab = byKey[k];
      if (!tab) return;
      if (tab === 'chat') {
        setSheet(null);
        L.setChatOpen(!L.chatOpen);
      } else setSheet(sheet === tab ? null : tab);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, sheet, setSheet]);
}

function Ui({ sheet, setSheet }: { sheet: SheetTab | null; setSheet: (t: SheetTab | null) => void }) {
  const guest = useGame((s) => oreLive && !s.wallet.owner);
  const { desktop } = useLayout();
  useHotkeys(sheet, setSheet, desktop && !guest);
  return (
    <>
      {!guest && <>
        <TopBar onMenu={() => setSheet('me')} />
        {desktop ? <SidePanel /> : <RoundCard />}
        {desktop ? null : <Dock />}
        <TabBar active={sheet} onTab={setSheet} />
        <MapHint />
        <CaveEntry />
        <LobbyBack />
        <ClaimPanel />
        <PeerCard />
        <ResultPop />
        <LevelUp />
        <GearReveal />
        <SharedChat />
        <LobbyScreen onMarket={() => setSheet('gear')} sheet={sheet} onTab={setSheet} />
        <Sheet tab={sheet} onTab={setSheet} />
      </>}
        <Toasts />
        <Busy />
        <WalletGate />
        <Onboarding />
        <WalletPicker />
        <LiveNotice />
        {!guest && <CaveScreen />}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
});
