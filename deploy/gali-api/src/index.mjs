// Routes api.gali.lol to the shared handlers: /games (arcade house), /rpc and /rpc2 (read-only RPC proxy).
import games from '../../../app/rpc-backend/functions/games.mjs';
import rpc from '../../../app/rpc-backend/functions/rpc.mjs';

const WEB_ORIGINS = ['https://betatest.gali.lol', 'https://admin.gali.lol', 'https://gali.lol', 'https://www.gali.lol', 'http://localhost:8081'];

/** The RPC proxy had Bounded's "app" CORS; here: the Gali web origins only (the Android app sends no Origin). */
function rpcCors(req) {
  const o = req.headers.get('origin');
  return o && WEB_ORIGINS.includes(o)
    ? { 'access-control-allow-origin': o, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, solana-client', 'access-control-max-age': '600', vary: 'Origin' } // web3.js sends solana-client
    : null;
}
const tooMany = () => new Response(JSON.stringify({ error: 'Too many requests. Try again in a minute.' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } });

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    if (path === '/games') {
      if (req.method !== 'OPTIONS' && env.GAMES_LIMIT && !(await env.GAMES_LIMIT.limit({ key: ip })).success) return tooMany();
      return games(req, { env });
    }
    if (path === '/rpc' || path === '/rpc2') {
      const cors = rpcCors(req);
      if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
      if (req.headers.get('origin') && !cors) return new Response('origin not allowed', { status: 403 });
      if (env.RPC_LIMIT && !(await env.RPC_LIMIT.limit({ key: ip })).success) return tooMany();
      const res = await rpc(req, { env });
      if (!cors) return res;
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }
    if (path === '' || path === '/health') return new Response('Gali API', { status: 200 });
    return new Response('not found', { status: 404 });
  },
};
