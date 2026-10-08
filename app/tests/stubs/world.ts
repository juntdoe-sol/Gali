// test stub for game/world.ts: an in-process "realtime" bus shared through globalThis.__bus
import { create } from 'zustand';
const bus: any = (globalThis as any).__bus;
export const worldReady = true;
export const useWorld = create<{ status: string }>(() => ({ status: 'online' }));
export const worldClient = () => ({
  channel(name: string) {
    const handlers: Record<string, (m: { payload: unknown }) => void> = {};
    const ch: any = {
      on(_t: string, f: { event: string }, cb: any) { handlers[f.event] = cb; return ch; },
      subscribe(cb: (s: string) => void) { bus.join(name, handlers, ch); setTimeout(() => cb('SUBSCRIBED'), 1); return ch; },
      send(m: { event: string; payload: unknown }) { bus.send(name, ch, m.event, m.payload); return Promise.resolve('ok'); },
      unsubscribe() { bus.leave(name, ch); return Promise.resolve('ok'); },
    };
    return ch;
  },
});
