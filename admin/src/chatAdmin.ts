import chatCfg from '../../app/src/chain/chat.json';

export const chatReady = Boolean(chatCfg.url && chatCfg.anonKey);

export interface ChatRow {
  id: number;
  wallet: string;
  name: string;
  level: number;
  kind: 'msg' | 'tip';
  body: string;
  tip_to: string | null;
  tip_amount: number | null;
  hidden: boolean;
  created_at: string;
}
export interface MutedRow {
  wallet: string;
  reason: string | null;
  muted_by: string;
  created_at: string;
}

type Action = 'list' | 'hide' | 'unhide' | 'mute' | 'unmute';
type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Every moderation call is signed by the admin wallet; the server checks it is the program's authority. */
export async function chatAdmin<T = { ok: true }>(admin: string, signMessage: SignMessage, action: Action, target = '', reason = ''): Promise<T> {
  const ts = Date.now();
  const sig = await signMessage(new TextEncoder().encode(`gali-admin:${action}:${target}:${ts}`));
  const r = await fetch(`${chatCfg.url}/functions/v1/chat-admin`, {
    method: 'POST',
    headers: { apikey: chatCfg.anonKey, Authorization: `Bearer ${chatCfg.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin, action, target, reason, ts, sig: toBase64(sig) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Chat server error ${r.status}`);
  return j as T;
}
