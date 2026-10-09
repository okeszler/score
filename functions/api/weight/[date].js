import { json, readJson, handler, HttpError } from '../../../lib/http.js';
import { assertDate, weightFromBody } from '../../../lib/validate.js';

export const onRequestPut = handler(async ({ params, request, env }) => {
  const date = assertDate(params.date);
  const w = weightFromBody(await readJson(request));
  await env.DB.prepare(`INSERT INTO weight (entry_date, weight_kg, body_fat_pct, muscle_kg, body_water_kg) VALUES (?,?,?,?,?)
    ON CONFLICT(entry_date) DO UPDATE SET weight_kg=COALESCE(excluded.weight_kg, weight_kg),
      body_fat_pct=COALESCE(excluded.body_fat_pct, body_fat_pct), muscle_kg=COALESCE(excluded.muscle_kg, muscle_kg),
      body_water_kg=COALESCE(excluded.body_water_kg, body_water_kg)`)
    .bind(date, w.weight_kg, w.body_fat_pct, w.muscle_kg, w.body_water_kg).run();
  return json({ ok: true });
});

// Löscht manuelle Werte UND Sync-Messungen dieses Tages (z. B. Fehlmessung der Waage)
export const onRequestDelete = handler(async ({ params, env }) => {
  const date = assertDate(params.date);
  const [a, b] = await env.DB.batch([
    env.DB.prepare('DELETE FROM weight WHERE entry_date = ?').bind(date),
    env.DB.prepare('DELETE FROM sync_weight_readings WHERE entry_date = ?').bind(date),
  ]);
  if (!a.meta.changes && !b.meta.changes) throw new HttpError('Eintrag nicht gefunden', 404);
  return json({ ok: true });
});
