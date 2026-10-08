const mem: Map<string, string> = (globalThis as any).__mem;
export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const raw = mem.get(key);
  return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
}
export function saveJson(key: string, value: unknown) { mem.set(key, JSON.stringify(value)); }
