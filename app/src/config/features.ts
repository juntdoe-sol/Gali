/**
 * Feature flags. One switch per part of the game that is not live yet.
 *
 * Off (the default in every release build), the feature is invisible: no tab, no door, no "coming soon".
 * Turn one on for a local or test build with EXPO_PUBLIC_FEATURE_<NAME>=1. Expo inlines these at build time.
 */
const on = (v: string | undefined) => v === '1' || v === 'true';

/** Points, streaks, the SKR jackpot, SKR staking (BOOST) and gear buying. Needs the Gali program, which is not deployed. */
export const FEATURE_GALI_PROGRAM = on(process.env.EXPO_PUBLIC_FEATURE_GALI_PROGRAM);
