// Bot mining is closed while it is being tuned: only these wallets can start it, and the miner plays only for them.
// The app keeps the same list (app/src/game/aiMining.ts BOT_WALLETS). Empty the list to open it to everyone.
export const BOT_WALLETS: readonly string[] = [
  'PNX9utQBdEs4W7vMNop4wkuzPEsd84dGbMgFeVcoKYa',
  'JANRmfiFcQo2D251hQfqmpYzGCrEzqjCid7kisv3Vpym',
];
export const botAllowed = (wallet: string) => BOT_WALLETS.length === 0 || BOT_WALLETS.includes(wallet);
