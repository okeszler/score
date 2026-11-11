import { checkPin, claimAttempt, createSession, lockMessage, resetAttempts, signingKey } from '../../lib/auth.js';
import { json, error, readJson, handler } from '../../lib/http.js';

export const onRequestPost = handler(async ({ request, env }) => {
  const { password } = await readJson(request);
  // Versuch zuerst atomar verbuchen: so lassen sich auch mit vielen parallelen Anfragen
  // nicht mehr PINs durchprobieren als erlaubt. Während einer Sperre wird gar nicht verglichen.
  if (!(await claimAttempt(env))) return error(await lockMessage(env), 429);
  if (!(await checkPin(env, password))) {
    await new Promise(r => setTimeout(r, 800));
    return error('Falsche PIN', 401);
  }
  await resetAttempts(env);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(await signingKey(env)) });
});
