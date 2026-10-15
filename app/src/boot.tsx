/**
 * Start-up: on Android, read the miner's screen choice (landscape or portrait) and lock the screen
 * to it before any layout code loads, because the layout picks its shape once (ui/layout.ts).
 * Switching in PROFILE saves the choice and restarts the app.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';

export const ORIENT_KEY = 'gali-orient-v1';
export type Orient = 'landscape' | 'portrait';

export function Boot() {
  const [App, setApp] = useState<ComponentType | null>(null);
  useEffect(() => {
    void (async () => {
      if (Platform.OS === 'android') {
        let o: Orient = 'landscape';
        try {
          o = (await AsyncStorage.getItem(ORIENT_KEY)) === 'portrait' ? 'portrait' : 'landscape';
        } catch {
          /* first run */
        }
        (globalThis as { __GALI_ORIENT?: Orient }).__GALI_ORIENT = o;
        try {
          await ScreenOrientation.lockAsync(o === 'portrait' ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE);
        } catch {
          /* keep whatever the phone is doing */
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      setApp(() => require('./App').default as ComponentType);
    })();
  }, []);
  return App ? <App /> : null;
}
