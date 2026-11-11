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

const baseSecret = env => {
  const base = env.SESSION_SECRET || env.CRON_SECRET;
  if (!base) throw new Error('SESSION_SECRET ist nicht gesetzt');
  return base;
};

export const PIN_MIN = 6;

/**
 * In der App gesetzte PIN (nur als HMAC mit dem Secret gespeichert, Tabelle auth_secret).
 * Solange keine gesetzt ist, gilt das Secret APP_PASSWORD.
 */
async function storedPin(env) {
  if (!env.DB) return null;
  try {
    return (await env.DB.prepare(`SELECT value FROM auth_secret WHERE key = 'pin'`).first())?.value ?? null;
  } catch {
    return null; // Tabelle existiert noch nicht (frische Datenbank)
  }
}

/** Signierschlüssel für Sessions und WebAuthn-Challenges (nie die PIN selbst). Ändert sich die PIN, ändert er sich mit. */
export async function signingKey(env) {
  const base = baseSecret(env);
  return hmac(base, `score-key:${(await storedPin(env)) ?? env.APP_PASSWORD}`);
}

export async function checkPin(env, pin) {
  if (typeof pin !== 'string') return false;
  const stored = await storedPin(env);
  if (stored) return safeEqual(await hmac(baseSecret(env), `pin:${pin}`), stored);
  return safeEqual(pin, env.APP_PASSWORD);
}

/** true, wenn noch die kurze Start-PIN (Secret) gilt */
export async function pinIsShort(env) {
  return !(await storedPin(env)) && String(env.APP_PASSWORD || '').length < PIN_MIN;
}

export async function setPin(env, pin) {
  await env.DB.prepare(`INSERT INTO auth_secret (key, value) VALUES ('pin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(await hmac(baseSecret(env), `pin:${pin}`)).run();
}

// ---------- Sperre gegen Durchprobieren (gilt für Login und PIN-Änderung) ----------
const FREE_TRIES = 5; // danach Sperre: 1 min, 2 min, 4 min … höchstens 1 h

/** Versuch atomar verbuchen. Liefert null, wenn gesperrt (dann gar nicht prüfen), sonst true. */
export async function claimAttempt(env) {
  const now = Math.floor(Date.now() / 1000);
  const claim = await env.DB.prepare(`UPDATE auth_state SET fails = fails + 1,
      locked_until = CASE WHEN fails + 1 >= ?2 THEN ?1 + MIN(3600, 60 * (1 << MIN(fails + 1 - ?2, 6))) ELSE 0 END
    WHERE key = 'pin' AND locked_until <= ?1 RETURNING fails`).bind(now, FREE_TRIES).first();
  return !!claim;
}

export async function lockMessage(env) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT locked_until FROM auth_state WHERE key = 'pin'`).first();
  const min = Math.max(1, Math.ceil(((row?.locked_until ?? now) - now) / 60));
  return `Zu viele Fehlversuche. Bitte in ${min} ${min === 1 ? 'Minute' : 'Minuten'} erneut versuchen (Fingerabdruck geht weiterhin).`;
}

export async function resetAttempts(env) {
  await env.DB.prepare(`UPDATE auth_state SET fails = 0, locked_until = 0 WHERE key = 'pin'`).run();
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
