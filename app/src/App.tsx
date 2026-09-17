import { ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { RussoOne_400Regular } from '@expo-google-fonts/russo-one';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from './game/constants';
import { watchMotion } from './game/motion';
import { initAudio } from './game/sfx';
import { useGame } from './game/store';
import { ChatButton, ChatSheet } from './ui/Chat';
import { Dock } from './ui/Dock';
import { RoundCard, Toasts, TopBar } from './ui/Hud';
import { Busy, GearReveal, LevelUp, Onboarding, ResultPop, WalletPicker } from './ui/Modals';
import { Sheet } from './ui/Sheet';

const Scene = lazy(() => import('./scene/Scene'));

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

async function scheduleDailyReminder() {
  try {
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
  const [fontsLoaded] = useFonts({ RussoOne_400Regular, ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold });
  const [menu, setMenu] = useState(false);
  const tilt = useRef({ x: 0, y: 0 }).current;
  const onboarded = useGame((s) => s.save.onboarded);

  useEffect(() => {
    initAudio();
    void useGame.getState().boot();
    const id = setInterval(() => useGame.getState().tick(), 100);
    const stop = watchMotion(({ x, y }) => {
      tilt.x += (x - tilt.x) * 0.15;
      tilt.y += (y - tilt.y) * 0.15;
    });
    return () => {
      clearInterval(id);
      stop();
    };
  }, [tilt]);

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
        <Suspense
          fallback={
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Image source={require('../assets/brand/mark512.png')} style={{ width: 110, height: 110 }} />
            </View>
          }
        >
          <View style={StyleSheet.absoluteFill}>
            <Scene tilt={tilt} />
          </View>
        </Suspense>
        <TopBar onMenu={() => setMenu(true)} />
        <RoundCard />
        <Dock />
        <ChatButton />
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
