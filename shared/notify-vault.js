// A bot token kept in D1 (notify_channels.token_enc): AES-GCM under a key made from the Worker secret NOTIFY_SECRET, so a copy of the database alone shows no token.
// Why (5 Nov 2026, owner: "allow me to change the Telegram bot"): "Change bot" has to work for every alert, so the tokens live in the Worker, once; the owner types a token into Admin, it is never shown back.
// Format: "v1.<iv>.<ciphertext>", both base64url. No NOTIFY_SECRET: seal() throws 'no-secret' (the page says so) and open() returns null.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
async function keyOf(secret) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`notify-vault|${secret}`)), 'AES-GCM', false, ['encrypt', 'decrypt']); }

/** The token as stored text. Throws Error('no-secret') when the Worker has no NOTIFY_SECRET. */
export async function seal(env, token) {
  if (!env.NOTIFY_SECRET) throw new Error('no-secret');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `v1.${b64(iv)}.${b64(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await keyOf(env.NOTIFY_SECRET), enc.encode(token)))}`;
}
/** The token behind stored text, or null (no secret, other secret, damaged text). */
export async function open(env, stored) {
  const [version, iv, body] = String(stored || '').split('.');
  if (version !== 'v1' || !iv || !body || !env.NOTIFY_SECRET) return null;
  try { return dec.decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, await keyOf(env.NOTIFY_SECRET), unb64(body))); } catch { return null; }
}
