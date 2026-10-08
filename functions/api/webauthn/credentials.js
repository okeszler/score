import { json, handler, HttpError } from '../../../lib/http.js';

export const onRequestGet = handler(async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT id, label, created_at, last_used FROM webauthn_credentials ORDER BY created_at').all();
  return json({ credentials: results });
});

export const onRequestDelete = handler(async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw new HttpError('id fehlt');
  const r = await env.DB.prepare('DELETE FROM webauthn_credentials WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError('Nicht gefunden', 404);
  return json({ ok: true });
});
