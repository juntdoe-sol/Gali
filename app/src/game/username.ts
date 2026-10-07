/**
 * The name other players see: chosen once, kept on this device. The lobby, the
 * island and the lobby chat all use it. It is only a label: it proves nothing, and
 * a wallet badge still means a verified wallet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { cleanName } from './lobbyMap';

const KEY = 'gali-name-v1';

interface NameState {
  name: string;
  /** the saved name has been read (so a first-time prompt does not flash for a returning player) */
  ready: boolean;
  set: (raw: string) => boolean;
}

export const useName = create<NameState>((set) => ({
  name: '',
  ready: false,
  set: (raw) => {
    const name = cleanName(raw);
    if (!name) return false;
    set({ name });
    AsyncStorage.setItem(KEY, name).catch(() => undefined);
    return true;
  },
}));

AsyncStorage.getItem(KEY)
  .then((v) => useName.setState({ name: cleanName(v), ready: true }))
  .catch(() => useName.setState({ ready: true }));
