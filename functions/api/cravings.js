import { json, readJson, handler, HttpError } from '../../lib/http.js';
import { assertDate, num } from '../../lib/validate.js';
import { isValidDate } from '../../public/assets/score.js';

export const TRIGGERS = ['stress', 'langeweile', 'hitze', 'abend'];

// GET /api/cravings?from=YYYY-MM-DD  ·  POST { entry_date, started_at, level?, triggers?, completed?, drank? }
export const onRequestGet = handler(async ({ request, env }) => {
  const from = new URL(request.url).searchParams.get('from') || '0000-01-01';
  if (from !== '0000-01-01' && !isValidDate(from)) throw new HttpError('Ungültiges Datum');
  const { results } = await env.DB.prepare('SELECT * FROM cravings WHERE entry_date >= ? ORDER BY entry_date, started_at').bind(from).all();
  return json({ cravings: results.map(r => ({ ...r, triggers: safeList(r.triggers) })) });
});

export const onRequestPost = handler(async ({ request, env }) => {
  const b = await readJson(request);
  const date = assertDate(b.entry_date);
  const time = /^\d{2}:\d{2}$/.test(b.started_at || '') ? b.started_at : null;
  if (!time) throw new HttpError('Uhrzeit fehlt');
  const level = num(b.level, 'Verlangen', 1, 5, { int: true });
  const triggers = Array.isArray(b.triggers) ? [...new Set(b.triggers.filter(t => TRIGGERS.includes(t)))] : [];
  const r = await env.DB.prepare(`INSERT INTO cravings (entry_date, started_at, level, triggers, completed, drank) VALUES (?,?,?,?,?,?) RETURNING id`)
    .bind(date, time, level, JSON.stringify(triggers), b.completed ? 1 : 0, b.drank ? 1 : 0).first();
  return json({ id: r.id });
});

function safeList(v) {
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}
