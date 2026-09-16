import { Accelerometer } from 'expo-sensors';

type Reading = { x: number; y: number; z: number };

/** Subscribe to the accelerometer if the device has one. Never throws. */
export function watchMotion(cb: (r: Reading) => void, intervalMs = 120): () => void {
  let sub: { remove: () => void } | null = null;
  let cancelled = false;
  Accelerometer.isAvailableAsync()
    .then((ok) => {
      if (!ok || cancelled) return;
      try {
        Accelerometer.setUpdateInterval(intervalMs);
        sub = Accelerometer.addListener(cb);
      } catch {
        /* sensor unavailable */
      }
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    try {
      sub?.remove();
    } catch {
      /* ignore */
    }
  };
}
