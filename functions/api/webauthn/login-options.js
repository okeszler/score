import { json, handler } from '../../../lib/http.js';
import { createChallenge } from '../../../lib/webauthn.js';

export const onRequestGet = handler(async ({ request, env }) => {
  const { results } = await env.DB.prepare('SELECT id FROM webauthn_credentials').all();
  if (!results.length) return json({ available: false });
  const { token, challenge } = await createChallenge(env.APP_PASSWORD, 'login');
  return json({ available: true, token, challenge, rpId: new URL(request.url).hostname, allowCredentials: results.map(r => r.id) });
});
