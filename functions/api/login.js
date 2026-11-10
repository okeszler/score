import { createSession, safeEqual, signingKey } from '../../lib/auth.js';
import { json, error, readJson, handler } from '../../lib/http.js';

const FREE_TRIES = 5; // danach Sperre: 1 min, 2 min, 4 min … höchstens 1 h

export const onRequestPost = handler(async ({ request, env }) => {
  const { password } = await readJson(request);
  const now = Math.floor(Date.now() / 1000);
  // Versuch zuerst atomar verbuchen: so lassen sich auch mit vielen parallelen Anfragen
  // nicht mehr PINs durchprobieren als erlaubt. Während einer Sperre wird gar nicht verglichen.
  const claim = await env.DB.prepare(`UPDATE auth_state SET fails = fails + 1,
      locked_until = CASE WHEN fails + 1 >= ?2 THEN ?1 + MIN(3600, 60 * (1 << MIN(fails + 1 - ?2, 6))) ELSE 0 END
    WHERE key = 'pin' AND locked_until <= ?1 RETURNING fails`).bind(now, FREE_TRIES).first();
  if (!claim) {
    const row = await env.DB.prepare(`SELECT locked_until FROM auth_state WHERE key = 'pin'`).first();
    const min = Math.max(1, Math.ceil(((row?.locked_until ?? now) - now) / 60));
    return error(`Zu viele Fehlversuche. Bitte in ${min} ${min === 1 ? 'Minute' : 'Minuten'} erneut versuchen (Fingerabdruck geht weiterhin).`, 429);
  }
  if (typeof password !== 'string' || !safeEqual(password, env.APP_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800));
    return error('Falsche PIN', 401);
  }
  await env.DB.prepare(`UPDATE auth_state SET fails = 0, locked_until = 0 WHERE key = 'pin'`).run();
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(await signingKey(env)) });
});
