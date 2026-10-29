# Gali relay

One Cloudflare Durable Object that carries the shared rooms (island, lobby, chat, Arena) and the ORE
board feed over one WebSocket per player. Built for the public launch: 100 miners online at once on
free plans.

## Why

On Supabase Realtime every broadcast is billed once per listener, so a room costs players squared.
At 100 online that is about 2,700 messages a second against the Free plan's 100, and the 2 million
monthly messages are gone in about 12 minutes.

Cloudflare bills only incoming WebSocket messages, at 20 messages per request, and not outgoing ones.
Fanning a message out to 100 players costs the same as sending it to one.

The relay also reads ORE's board and current round once every 3 s and pushes them to everyone, so
players stop polling the RPC. RPC use stays at about one call every 3 s however many are online.

## Measured (test/relay.test.ts, 100 simulated miners for 60 s)

60 in the lobby, 30 on the island, 10 fighting in the Arena, everyone in chat:

| | |
| --- | --- |
| Incoming messages | 107.9 a second |
| Billed requests | 5.4 a second |
| 3-hour peak at 100 online | 58,284 requests |
| Free plan daily allowance | 100,000 requests |
| Relay CPU per flush | under 0.1 ms |

So the Free plan covers about 5 hours a day of a full 100-player crowd. Smaller crowds last longer.
Past the allowance Cloudflare refuses requests until 00:00 UTC (08:00 MYT); it never bills on Free.
Workers Paid ($5/month minimum) includes 1 million requests a month and removes the daily cap.

## Deploy (macOS Terminal)

```
cd ~/Documents/gali-push/relay
npm install
npx wrangler login
npx wrangler secret put HELIUS_RPC_URL
npx wrangler deploy
curl https://relay.gali.lol/health
```

`HELIUS_RPC_URL` is the full Helius URL with the key. Paste it only into the wrangler prompt.
Optional second upstream: `npx wrangler secret put ALCHEMY_RPC_URL`.

`wrangler deploy` attaches relay.gali.lol as a custom domain (gali.lol is already on Cloudflare).

## App side

- `EXPO_PUBLIC_RELAY_URL=wss://relay.gali.lol/ws` (already in the `apk-live` profile in app/eas.json;
  add it to app/.env.local for web builds).
- app/src/game/relay.ts speaks the part of Supabase's channel API the rooms use, so world.ts, lobby.ts
  and arena.ts are unchanged apart from world.ts choosing the connection.
- If the relay does not answer within 8 s, a build that also has the Supabase lines falls back to
  Supabase Realtime.
- The board feed (app/src/game/oreFeed.ts) replaces the app's own clock and pot reads while it is
  fresh (under 9 s old). Without it the app polls as before.

Builds without the relay (APK 1.7.0 and older) stay on Supabase and will not see relay players.

## Limits in the relay

Rooms: island 150, lobby 100, chat 400, Arena 60. 400 sockets in total, 30 per IP (phones on one
carrier or one venue Wi-Fi share an IP). 12 messages a second per player with a burst of 30; a socket
that keeps flooding is closed. Frames over 16 KB are dropped.

`GET /health` shows sockets, room sizes and the board feed's age.

## Test

```
npm test
```

Node 22.13 or newer, no packages needed.
