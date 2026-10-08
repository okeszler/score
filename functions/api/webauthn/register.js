import { json, readJson, handler, HttpError } from '../../../lib/http.js';
import { text } from '../../../lib/validate.js';
import { verifyRegistration } from '../../../lib/webauthn.js';

export const onRequestPost = handler(async ({ request, env }) => {
  const body = await readJson(request);
  const url = new URL(request.url);
  let cred;
  try {
    cred = await verifyRegistration({ secret: env.APP_PASSWORD, token: body.token, origin: url.origin, rpId: url.hostname, body });
  } catch (e) {
    throw new HttpError(`Einrichtung fehlgeschlagen: ${e.message}`, 400);
  }
  await env.DB.prepare(`INSERT INTO webauthn_credentials (id, public_key, alg, sign_count, label) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, alg = excluded.alg, sign_count = excluded.sign_count`)
    .bind(cred.id, cred.publicKey, cred.alg, cred.signCount, text(body.label, 80) || 'Gerät').run();
  return json({ ok: true });
});
