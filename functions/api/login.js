import { createSession, safeEqual } from '../../lib/auth.js';
import { json, error, readJson, handler } from '../../lib/http.js';

export const onRequestPost = handler(async ({ request, env }) => {
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !safeEqual(password, env.APP_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800)); // Brute-Force bremsen
    return error('Falsche PIN', 401);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env.APP_PASSWORD) });
});
