import { checkPin, claimAttempt, createSession, lockMessage, PIN_MIN, pinIsShort, resetAttempts, setPin, signingKey } from '../../lib/auth.js';
import { json, error, readJson, handler, HttpError } from '../../lib/http.js';

// GET /api/pin -> { short }   POST /api/pin { current, next } -> neue PIN, andere Geräte werden abgemeldet
export const onRequestGet = handler(async ({ env }) => json({ short: await pinIsShort(env), min: PIN_MIN }));

export const onRequestPost = handler(async ({ request, env }) => {
  const { current, next } = await readJson(request);
  if (typeof next !== 'string' || !new RegExp(`^\\d{${PIN_MIN},12}$`).test(next)) throw new HttpError(`Neue PIN: ${PIN_MIN} bis 12 Ziffern`);
  if (/^(\d)\1+$/.test(next) || '01234567890123'.includes(next) || '98765432109876'.includes(next)) throw new HttpError('Neue PIN ist zu leicht zu erraten');
  if (!(await claimAttempt(env))) return error(await lockMessage(env), 429);
  if (!(await checkPin(env, current))) {
    await new Promise(r => setTimeout(r, 800));
    return error('Aktuelle PIN ist falsch', 401);
  }
  if (current === next) throw new HttpError('Neue PIN muss sich unterscheiden');
  await setPin(env, next);
  await resetAttempts(env);
  // Schlüssel hat sich geändert: dieses Gerät bekommt eine neue Session, alle anderen sind abgemeldet
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(await signingKey(env)) });
});
