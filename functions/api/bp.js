import { json, readJson, handler, HttpError } from '../../lib/http.js';
import { assertDate, num, text } from '../../lib/validate.js';

// POST /api/bp {entry_date, reading_time?, systolic, diastolic, pulse?, note?}  ·  DELETE /api/bp?id=
export const onRequestPost = handler(async ({ request, env }) => {
  const b = await readJson(request);
  const date = assertDate(b.entry_date);
  const time = /^\d{2}:\d{2}(:\d{2})?$/.test(b.reading_time || '') ? (b.reading_time.length === 5 ? `${b.reading_time}:00` : b.reading_time) : '';
  const sys = num(b.systolic, 'Systolisch', 60, 260, { int: true });
  const dia = num(b.diastolic, 'Diastolisch', 30, 160, { int: true });
  if (sys == null || dia == null) throw new HttpError('Systolisch und diastolisch angeben');
  if (dia >= sys) throw new HttpError('Diastolisch muss kleiner als systolisch sein');
  const pulse = num(b.pulse, 'Puls', 25, 240, { int: true });
  await env.DB.prepare(`INSERT INTO blood_pressure (entry_date, reading_time, systolic, diastolic, pulse, note, source)
    VALUES (?,?,?,?,?,?,'manuell') ON CONFLICT(entry_date, reading_time, systolic, diastolic)
    DO UPDATE SET pulse = excluded.pulse, note = excluded.note`)
    .bind(date, time, sys, dia, pulse, text(b.note, 300)).run();
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env }) => {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id)) throw new HttpError('id fehlt');
  const r = await env.DB.prepare('DELETE FROM blood_pressure WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError('Nicht gefunden', 404);
  return json({ ok: true });
});
