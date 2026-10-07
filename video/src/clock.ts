/**
 * A virtual clock. The engine reads Date.now and performance.now; for a video
 * every frame must land exactly 1/30 s after the last, however long it took to
 * draw, so both are replaced before anything else loads. Math.random is seeded
 * so two renders of the same frame agree.
 */
// A whole number of 1080 ms dance loops since the epoch, so every dance in the lobby starts its loop on a beat of the score.
export const T0 = Date.UTC(2026, 9, 1, 2, 0, 0) - 720;
export const clock = { ms: 0 };
Date.now = () => T0 + clock.ms;
performance.now = () => clock.ms;
(window as unknown as { requestAnimationFrame: () => number }).requestAnimationFrame = () => 0;
let seed = 1234567;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
// the engine sizes its canvas in CSS pixels times this; render at 2x for crisp labels
Object.defineProperty(window, 'devicePixelRatio', { get: () => 2 });
