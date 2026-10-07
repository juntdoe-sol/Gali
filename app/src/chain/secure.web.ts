import AsyncStorage from '@react-native-async-storage/async-storage';

/** The browser has no secure store; the wallet extension holds the real keys. Same API as secure.ts. */
export const getSecret = (key: string): Promise<string | null> => AsyncStorage.getItem(key);
export const setSecret = (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value);
export const removeSecret = (key: string): Promise<void> => AsyncStorage.removeItem(key);
