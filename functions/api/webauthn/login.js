import { createSession, signingKey } from '../../../lib/auth.js';
import { error, json, readJson, handler } from '../../../lib/http.js';
import { verifyAssertion } from '../../../lib/webauthn.js';

export const onRequestPost = handler(async ({ request, env }) => {
  const body = await readJson(request);
  const url = new URL(request.url);
  const credential = typeof body.id === 'string'
    ? await env.DB.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').bind(body.id).first() : null;
  try {
    if (!credential) throw new Error('Unbekanntes Gerät');
    const { signCount } = await verifyAssertion({ secret: await signingKey(env), token: body.token, origin: url.origin, rpId: url.hostname, body, credential });
    await env.DB.prepare(`UPDATE webauthn_credentials SET sign_count = ?, last_used = datetime('now') WHERE id = ?`).bind(signCount, credential.id).run();
  } catch (e) {
    await new Promise(r => setTimeout(r, 800));
    console.error(e);
    return error('Fingerabdruck-Anmeldung fehlgeschlagen', 401);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(await signingKey(env)) });
});
