import { json, readJson, handler, HttpError } from '../../lib/http.js';
import { assertDate, text } from '../../lib/validate.js';

// Blutwerte: frei benannt (Testname + Einheit), rückwirkend erfassbar
function labFromBody(b) {
  const entry_date = assertDate(b.entry_date);
  const test_name = text(b.test_name, 80);
  if (!test_name) throw new HttpError('Testname fehlt');
  const value = typeof b.value === 'string' ? Number(b.value.replace(',', '.')) : Number(b.value);
  if (!Number.isFinite(value)) throw new HttpError('Wert muss eine Zahl sein');
  return { entry_date, test_name, value, unit: text(b.unit, 30), note: text(b.note, 300) };
}

export const onRequestGet = handler(async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT * FROM lab_results ORDER BY entry_date DESC, id DESC').all();
  return json({ labs: results });
});

export const onRequestPost = handler(async ({ request, env }) => {
  const l = labFromBody(await readJson(request));
  await env.DB.prepare('INSERT INTO lab_results (entry_date, test_name, value, unit, note) VALUES (?,?,?,?,?)')
    .bind(l.entry_date, l.test_name, l.value, l.unit, l.note).run();
  return json({ ok: true });
});

export const onRequestPut = handler(async ({ request, env }) => {
  const b = await readJson(request);
  const id = Number(b.id);
  if (!Number.isInteger(id)) throw new HttpError('id fehlt');
  const l = labFromBody(b);
  const r = await env.DB.prepare('UPDATE lab_results SET entry_date = ?, test_name = ?, value = ?, unit = ?, note = ? WHERE id = ?')
    .bind(l.entry_date, l.test_name, l.value, l.unit, l.note, id).run();
  if (!r.meta.changes) throw new HttpError('Nicht gefunden', 404);
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env }) => {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id)) throw new HttpError('id fehlt');
  const r = await env.DB.prepare('DELETE FROM lab_results WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError('Nicht gefunden', 404);
  return json({ ok: true });
});
