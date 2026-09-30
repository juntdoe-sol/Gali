import AsyncStorage from '@react-native-async-storage/async-storage';

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

let timers: Record<string, ReturnType<typeof setTimeout>> = {};
export function saveJson(key: string, value: unknown, delay = 400) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
  }, delay);
}
