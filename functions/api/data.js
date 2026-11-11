import { getDays, getGoals, getWeights } from '../../lib/db.js';
import { json, handler, HttpError } from '../../lib/http.js';
import { isValidDate } from '../../public/assets/score.js';

// GET /api/data?from=YYYY-MM-DD&to=YYYY-MM-DD
// Liefert Rohdaten; Scores werden im Client mit derselben score.js berechnet.
export const onRequestGet = handler(async ({ request, env }) => {
  const p = new URL(request.url).searchParams;
  const from = p.get('from') || '0000-01-01';
  const to = p.get('to') || '9999-12-31';
  if ((p.has('from') && !isValidDate(from)) || (p.has('to') && !isValidDate(to))) throw new HttpError('Ungültiger Zeitraum');
  const [{ days, synced, food, infoRead }, weights, goals, ch] = await Promise.all([
    getDays(env.DB, from, to),
    // Gewicht immer komplett: für Startgewicht, Fortschritt und Trend nötig
    getWeights(env.DB),
    getGoals(env.DB),
    env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'challenge'`).first(),
  ]);
  let challenge = null;
  try { challenge = ch ? JSON.parse(ch.value) : null; } catch {}
  return json({ days, synced, food, infoRead, weights, goals, challenge });
});
