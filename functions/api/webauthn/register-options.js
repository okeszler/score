import { json, handler } from '../../../lib/http.js';
import { createChallenge } from '../../../lib/webauthn.js';

// Nur mit gültiger Session erreichbar (Middleware)
export const onRequestGet = handler(async ({ request, env }) => {
  const { hostname } = new URL(request.url);
  const { token, challenge } = await createChallenge(env.APP_PASSWORD, 'register');
  const { results } = await env.DB.prepare('SELECT id FROM webauthn_credentials').all();
  return json({
    token, challenge,
    rp: { id: hostname, name: 'Olivers Score' },
    user: { id: 'b2xpdmVy', name: 'oliver', displayName: 'Oliver' },
    excludeCredentials: results.map(r => r.id),
  });
});
