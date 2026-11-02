// Text from players on its way into Gali AI's review and the subscribers' log. Pure, shared with the Node tests.

/** A comment made safe to store and show: plain text, no links, at most 200 characters. */
export function cleanComment(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/\b[a-z0-9-]+\.(?:com|io|xyz|gg|lol|net|org|app|me|co|fun|sol)\b\S*/gi, '[link]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
