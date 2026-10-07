import { useAppFonts } from './fonts';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from './game/constants';
import { oreLive } from './chain/light';
import { initAudio } from './game/sfx';
import { useGame } from './game/store';
import PixelMine from './pixel/PixelMine';
import { useWorld } from './game/world';
import { ChatSheet } from './ui/Chat';
import { TabBar, type SheetTab } from './ui/TabBar';
import { Dock } from './ui/Dock';
import { RoundCard, Toasts, TopBar } from './ui/Hud';
import { Busy, GearReveal, LevelUp, LiveNotice, Onboarding, ResultPop, WalletGate, WalletPicker } from './ui/Modals';
import { Sheet } from './ui/Sheet';
import { ClaimPanel } from './ui/ClaimPanel';
import { MapHint } from './ui/MapHint';
import { Splash } from './ui/Splash';
import { PeerCard } from './ui/World';
import { ExpeditionEntry, ExpeditionPanel } from './ui/Expedition';


// lets browser tests watch the game state
if (Platform.OS === 'web') Object.assign(globalThis, { __gali: useGame, __galiWorld: useWorld });
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

function Ui({ sheet, setSheet }: { sheet: SheetTab | null; setSheet: (t: SheetTab | null) => void }) {
  const guest = useGame((s) => oreLive && !s.wallet.owner);
  return (
    <>
      {!guest && <>
        <TopBar onMenu={() => setSheet('me')} />
        <RoundCard />
        <Dock />
        <TabBar active={sheet} onTab={setSheet} />
        <MapHint />
        <ExpeditionEntry />
        <ClaimPanel />
        <PeerCard />
        <ResultPop />
        <LevelUp />
        <GearReveal />
        <Sheet tab={sheet} onTab={setSheet} />
        <ChatSheet />
      </>}
        <Toasts />
        <Busy />
        <WalletGate />
        <Onboarding />
        <WalletPicker />
        <LiveNotice />
        <ExpeditionPanel />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
});
