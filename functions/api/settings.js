import { json, readJson, handler, HttpError } from '../../lib/http.js';

// GET /api/settings -> { settings: { key: wert } }   PUT /api/settings { key, value }
export const onRequestGet = handler(async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT key, value FROM app_settings').all();
  const settings = {};
  for (const r of results) { try { settings[r.key] = JSON.parse(r.value); } catch {} }
  return json({ settings });
});

export const onRequestPut = handler(async ({ request, env }) => {
  const { key, value } = await readJson(request);
  if (typeof key !== 'string' || !/^[a-z_]{1,40}$/.test(key)) throw new HttpError('Ungültiger Schlüssel');
  const v = JSON.stringify(value ?? null);
  if (v.length > 4000) throw new HttpError('Wert zu groß');
  await env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, v).run();
  return json({ ok: true });
});
