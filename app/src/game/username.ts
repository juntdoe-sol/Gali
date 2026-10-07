/**
 * The name other players see: chosen once, kept on this device. The lobby, the
 * island and the lobby chat all use it. It is only a label: it proves nothing, and
 * a wallet badge still means a verified wallet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { cleanName } from './lobbyMap';

const KEY = 'gali-name-v1';
const SEX_KEY = 'gali-sex-v1';
export type Sex = 'm' | 'f';

interface NameState {
  name: string;
  /** the saved name has been read (so a first-time prompt does not flash for a returning player) */
  ready: boolean;
  set: (raw: string) => boolean;
  /** which miner you play: the boy or the girl. Kept on this device. */
  sex: Sex;
  setSex: (s: Sex) => void;
}

export const useName = create<NameState>((set) => ({
  name: '',
  ready: false,
  sex: 'm',
  setSex: (s) => {
    set({ sex: s });
    AsyncStorage.setItem(SEX_KEY, s).catch(() => undefined);
  },
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

AsyncStorage.getItem(SEX_KEY)
  .then((v) => {
    if (v === 'f' || v === 'm') useName.setState({ sex: v });
  })
  .catch(() => undefined);
