import { json, handler, HttpError } from '../../lib/http.js';
import { isValidDate } from '../../public/assets/score.js';
import { dailyPulse, groupNights, restingHeartRate } from '../../public/assets/health.js';

// GET /api/health?from=YYYY-MM-DD -> Blutdruck, Puls/Ruhepuls, Schlafnächte, Aktivitäten, Blutwerte
export const onRequestGet = handler(async ({ request, env }) => {
  const from = new URL(request.url).searchParams.get('from') || '0000-01-01';
  if (from !== '0000-01-01' && !isValidDate(from)) throw new HttpError('Ungültiges Datum');
  const [bp, hourly, sleep, acts, labs] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM blood_pressure WHERE entry_date >= ? ORDER BY entry_date, reading_time').bind(from),
    env.DB.prepare('SELECT entry_date, hour, n, avg_bpm, min_bpm, max_bpm FROM sync_pulse_hourly WHERE entry_date >= ?').bind(from),
    // ein Tag Puffer, damit die erste Nacht (beginnt am Vorabend) vollständig ist
    env.DB.prepare("SELECT start_ts, seconds, stage FROM sync_sleep_segments WHERE start_ts >= date(?, '-1 day') ORDER BY start_ts").bind(from),
    env.DB.prepare('SELECT * FROM sync_activities WHERE entry_date >= ? ORDER BY entry_date DESC, start_time DESC').bind(from),
    // Blutwerte immer komplett (Verlauf über Jahre)
    env.DB.prepare('SELECT * FROM lab_results ORDER BY entry_date DESC, id DESC'),
  ]);
  const nights = groupNights(sleep.results).filter(n => n.date >= from);
  const resting = restingHeartRate(nights, hourly.results);
  const pulse = dailyPulse(hourly.results).map(p => ({ ...p, resting: resting[p.date] ?? null }));
  return json({
    bloodPressure: bp.results,
    pulse,
    nights: nights.filter(n => n.isNight).map(({ segments, ...n }) => n),
    lastNightSegments: nights.filter(n => n.isNight).at(-1)?.segments ?? [],
    activities: acts.results,
    labs: labs.results,
  });
});
