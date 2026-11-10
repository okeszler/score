// Stateless Session: Cookie = "<ablauf>.<hmac(ablauf)>".
// Schlüssel = HMAC(SESSION_SECRET, PIN): ohne das zufällige Secret lässt sich die PIN nicht offline
// aus einem Cookie oder einer WebAuthn-Challenge erraten; ändert sich die PIN, werden alle Sessions ungültig.

export const COOKIE = 'score_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage
const enc = new TextEncoder();

export async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Signierschlüssel für Sessions und WebAuthn-Challenges (nie die PIN selbst). */
export async function signingKey(env) {
  const base = env.SESSION_SECRET || env.CRON_SECRET;
  if (!base) throw new Error('SESSION_SECRET ist nicht gesetzt');
  return hmac(base, `score-key:${env.APP_PASSWORD}`);
}

export function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const token = `${exp}.${await hmac(secret, `score:${exp}`)}`;
  return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSession() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function verifySession(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  const now = Date.now() / 1000;
  if (!exp || !sig || !(Number(exp) >= now) || Number(exp) > now + MAX_AGE + 60) return false;
  return safeEqual(sig, await hmac(secret, `score:${exp}`));
}
