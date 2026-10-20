// Posts to Gali's social accounts through Zernio (https://zernio.com/agent-quickstart.md).
// Secrets: ZERNIO_API_KEY, ZERNIO_ACCOUNTS (JSON list of {platform, accountId} from GET /v1/accounts),
// ZERNIO_LIVE ("true" publishes right away; anything else saves a draft in the Zernio dashboard).
const ZERNIO_POSTS = 'https://zernio.com/api/v1/posts';

export type ZernioResult = { ok: boolean; live: boolean; id: string | null; error: string | null };

export async function zernioPost(content: string): Promise<ZernioResult> {
  const key = Deno.env.get('ZERNIO_API_KEY');
  const platforms = JSON.parse(Deno.env.get('ZERNIO_ACCOUNTS') ?? '[]');
  const live = Deno.env.get('ZERNIO_LIVE') === 'true';
  if (!key || !platforms.length) return { ok: false, live, id: null, error: 'missing ZERNIO_API_KEY or ZERNIO_ACCOUNTS' };
  // No scheduledFor and no publishNow = Zernio keeps it as a draft.
  const body = { content, platforms, ...(live ? { publishNow: true } : {}) };
  const res = await fetch(ZERNIO_POSTS, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, live, id: data?.post?._id ?? null, error: res.ok ? null : JSON.stringify(data).slice(0, 300) };
}
