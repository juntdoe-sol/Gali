import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted storage for wallet auth tokens and device keys (Android Keystore / iOS Keychain).
 * Anything saved in plain app storage by an older version is moved here the first time it is read.
 * Keys may only use letters, digits, ".", "-" and "_".
 */
export async function getSecret(key: string): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(key);
    if (v !== null) return v;
  } catch {
    /* secure store unavailable: fall through to the legacy copy */
  }
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  try {
    await SecureStore.setItemAsync(key, legacy);
    await AsyncStorage.removeItem(key); // only after the encrypted copy is saved
  } catch {
    /* keep the legacy copy so the key is never lost */
  }
  return legacy;
}

export async function setSecret(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
    await AsyncStorage.removeItem(key).catch(() => undefined);
  } catch {
    // Never lose a key because encryption failed: fall back to the old storage.
    await AsyncStorage.setItem(key, value);
  }
}

export async function removeSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
  await AsyncStorage.removeItem(key).catch(() => undefined);
}
