// Stateless Session: Cookie = "<ablauf>.<hmac(ablauf)>", Schlüssel = APP_PASSWORD.
// Ändert sich das Passwort, werden alle Sessions automatisch ungültig.

export const COOKIE = 'score_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(secret, `score:${exp}`));
}
