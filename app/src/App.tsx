import { ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { Jersey15_400Regular } from '@expo-google-fonts/jersey-15';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from './game/constants';
import { initAudio } from './game/sfx';
import { useGame } from './game/store';
import PixelMine from './pixel/PixelMine';
import { useWorld } from './game/world';
import { ChatButton, ChatSheet } from './ui/Chat';
import { Dock } from './ui/Dock';
import { RoundCard, Toasts, TopBar } from './ui/Hud';
import { Busy, GearReveal, LevelUp, Onboarding, ResultPop, WalletPicker } from './ui/Modals';
import { Sheet } from './ui/Sheet';
import { PeerCard } from './ui/World';


// lets browser tests watch the game state
if (Platform.OS === 'web') Object.assign(globalThis, { __gali: useGame, __galiWorld: useWorld });

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
      content: { title: '⛏ The mine is open', body: 'A new round every minute. Keep your streak alive and mine some SKR.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 9, minute: 0 },
    });
  } catch {
    /* notifications unavailable */
  }
}

export default function App() {
  const [fontsLoaded] = useFonts({ Jersey15_400Regular, ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold });
  const [menu, setMenu] = useState(false);
  const onboarded = useGame((s) => s.save.onboarded);

  useEffect(() => {
    initAudio();
    void useGame.getState().boot();
    const id = setInterval(() => useGame.getState().tick(), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (onboarded) void scheduleDailyReminder();
  }, [onboarded]);

  if (!fontsLoaded) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={COLORS.gold} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <PixelMine />
        <TopBar onMenu={() => setMenu(true)} />
        <RoundCard />
        <Dock />
        <ChatButton />
        <PeerCard />
        <Toasts />
        <Busy />
        <ResultPop />
        <LevelUp />
        <GearReveal />
        <Sheet open={menu} onClose={() => setMenu(false)} />
        <ChatSheet />
        <Onboarding />
        <WalletPicker />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
});
