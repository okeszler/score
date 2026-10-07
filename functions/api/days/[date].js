import { json, readJson, handler, HttpError } from '../../../lib/http.js';
import { assertDate, dayFromBody } from '../../../lib/validate.js';

export const onRequestGet = handler(async ({ params, env }) => {
  const date = assertDate(params.date);
  const row = await env.DB.prepare('SELECT * FROM days WHERE entry_date = ?').bind(date).first();
  const synced = await env.DB.prepare('SELECT steps FROM sync_steps_daily WHERE entry_date = ?').bind(date).first();
  return json({ day: row, synced_steps: synced?.steps ?? null });
});

export const onRequestPut = handler(async ({ params, request, env }) => {
  const date = assertDate(params.date);
  const d = dayFromBody(await readJson(request));
  await env.DB.prepare(`INSERT INTO days (entry_date, gym_kraft, gym_kardio, walk_km, steps, calories_tracked,
      calories_kcal, protein_g, water_ml, beer_count, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(entry_date) DO UPDATE SET gym_kraft=excluded.gym_kraft, gym_kardio=excluded.gym_kardio,
      walk_km=excluded.walk_km, steps=excluded.steps, calories_tracked=excluded.calories_tracked,
      calories_kcal=excluded.calories_kcal, protein_g=excluded.protein_g, water_ml=excluded.water_ml,
      beer_count=excluded.beer_count, note=excluded.note, updated_at=datetime('now')`)
    .bind(date, d.gym_kraft, d.gym_kardio, d.walk_km, d.steps, d.calories_tracked, d.calories_kcal,
      d.protein_g, d.water_ml, d.beer_count, d.note).run();
  const row = await env.DB.prepare('SELECT * FROM days WHERE entry_date = ?').bind(date).first();
  return json({ day: row });
});

// PATCH: einzelne Felder ändern (z. B. "+1 Bier" vom Dashboard)
export const onRequestPatch = handler(async ({ params, request, env }) => {
  const date = assertDate(params.date);
  const body = await readJson(request);
  if (!Number.isInteger(body.beer_delta) || Math.abs(body.beer_delta) > 5) throw new HttpError('beer_delta ungültig');
  await env.DB.prepare(`INSERT INTO days (entry_date, beer_count) VALUES (?, MAX(0, ?))
    ON CONFLICT(entry_date) DO UPDATE SET beer_count = MIN(40, MAX(0, beer_count + ?)), updated_at = datetime('now')`)
    .bind(date, body.beer_delta, body.beer_delta).run();
  const row = await env.DB.prepare('SELECT * FROM days WHERE entry_date = ?').bind(date).first();
  return json({ day: row });
});

export const onRequestDelete = handler(async ({ params, env }) => {
  const date = assertDate(params.date);
  const r = await env.DB.prepare('DELETE FROM days WHERE entry_date = ?').bind(date).run();
  if (!r.meta.changes) throw new HttpError('Eintrag nicht gefunden', 404);
  return json({ ok: true });
});
