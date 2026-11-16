// Trainingstage aus dem Gym-Tracker (D1-Datenbank "gymtracker-db", Binding GYM) übernehmen – nur lesend.
// Schema dort: log(ts ISO-UTC, person, uebung, gewicht, wdh), uebungen(name, gruppe, einheit).
// gruppe 'Cardio' -> gym_kardio, alle anderen -> gym_kraft. Cardio wird in Minuten geloggt (einheit 'min', gewicht = Minuten).

export const GYM_PERSON = 'Kratos';
export const GYM_TZ = 'Europe/Vienna';
export const BACKFILL_DAYS = 60;
export const RECENT_DAYS = 3;

const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** UTC-Zeitstempel -> lokaler Kalendertag in Wien ('YYYY-MM-DD'); 00:30 Ortszeit gehört zum neuen Tag. */
export function localDay(ts) {
  return fmtDate.format(new Date(ts));
}

/**
 * Sätze je Tag zusammenfassen.
 * rows: [{ ts, gewicht, wdh, gruppe, einheit }]
 * -> { 'YYYY-MM-DD': { kraft, kardio, saetze, volumen, cardio_min, start, ende } }
 */
export function aggregateGym(rows) {
  const out = {};
  for (const r of rows) {
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t)) continue;
    const day = localDay(r.ts);
    const d = (out[day] ||= { kraft: 0, kardio: 0, saetze: 0, volumen: 0, cardio_min: 0, start: r.ts, ende: r.ts });
    const cardio = r.gruppe === 'Cardio';
    if (cardio) { d.kardio = 1; if (r.einheit === 'min') d.cardio_min += Number(r.gewicht) || 0; }
    else { d.kraft = 1; if (r.einheit !== 'min') d.volumen += (Number(r.gewicht) || 0) * (Number(r.wdh) || 0); }
    d.saetze++;
    if (t < Date.parse(d.start)) d.start = r.ts;
    if (t > Date.parse(d.ende)) d.ende = r.ts;
  }
  for (const d of Object.values(out)) { d.volumen = Math.round(d.volumen); d.cardio_min = Math.round(d.cardio_min); }
  return out;
}

/**
 * Import: liest die Sätze von Kratos der letzten Tage (beim ersten Lauf 60, danach 3), speichert eine Tageszusammenfassung
 * in gym_days und setzt in days gym_kraft/gym_kardio nur hoch (MAX) – und nur für Tage, deren Gym-Daten sich geändert haben,
 * damit ein von Hand abgewähltes Training nicht bei jedem Lauf zurückkommt. Bestätigt den Tag nicht (neue Zeilen confirmed = 0).
 * Fehlt das Binding oder die Tabelle (lokal), wird still übersprungen.
 */
export async function importGym(env, { now = new Date(), days } = {}) {
  if (!env.GYM) return { skipped: 'kein Binding', days: 0, changed: [] };
  const done = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'gym_backfill_done'`).first();
  const span = days ?? (done ? RECENT_DAYS : BACKFILL_DAYS);
  // ein Tag Puffer wegen der Zeitzone (UTC-Grenze)
  const from = new Date(now.getTime() - (span + 1) * 86400000).toISOString();
  let rows;
  try {
    rows = (await env.GYM.prepare(`SELECT l.ts, l.gewicht, l.wdh, u.gruppe, u.einheit FROM log l
      LEFT JOIN uebungen u ON u.name = l.uebung WHERE l.person = ? AND l.ts >= ? ORDER BY l.ts`).bind(GYM_PERSON, from).all()).results;
  } catch (e) {
    if (/no such table/i.test(e.message)) return { skipped: 'keine Gym-Tabellen', days: 0, changed: [] };
    throw e;
  }
  const minDay = localDay(new Date(now.getTime() - span * 86400000).toISOString());
  const agg = Object.fromEntries(Object.entries(aggregateGym(rows)).filter(([d]) => d >= minDay));
  const dates = Object.keys(agg);
  if (!dates.length) {
    if (!done) await markBackfill(env);
    return { days: 0, changed: [] };
  }
  const { results: existing } = await env.DB.prepare(`SELECT * FROM gym_days WHERE entry_date IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(dates)).all();
  const prev = Object.fromEntries(existing.map(r => [r.entry_date, r]));
  const same = (a, b) => a && ['kraft', 'kardio', 'saetze', 'volumen', 'cardio_min', 'start', 'ende'].every(k => a[k] === b[k]);
  const changed = dates.filter(d => !same(prev[d], agg[d]));
  if (changed.length) {
    const rowsJson = JSON.stringify(changed.map(d => { const a = agg[d]; return [d, a.kraft, a.kardio, a.saetze, a.volumen, a.cardio_min, a.start, a.ende]; }));
    const J = i => `json_extract(value, '$[${i}]')`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO gym_days (entry_date, kraft, kardio, saetze, volumen, cardio_min, start, ende)
        SELECT ${[0, 1, 2, 3, 4, 5, 6, 7].map(J).join(', ')} FROM json_each(?) WHERE true
        ON CONFLICT(entry_date) DO UPDATE SET kraft = excluded.kraft, kardio = excluded.kardio, saetze = excluded.saetze,
          volumen = excluded.volumen, cardio_min = excluded.cardio_min, start = excluded.start, ende = excluded.ende,
          updated_at = datetime('now')`).bind(rowsJson),
      // nur hochsetzen; neue Tage entstehen unbestätigt (Bier ist noch offen)
      env.DB.prepare(`INSERT INTO days (entry_date, gym_kraft, gym_kardio, confirmed)
        SELECT ${J(0)}, ${J(1)}, ${J(2)}, 0 FROM json_each(?) WHERE true
        ON CONFLICT(entry_date) DO UPDATE SET gym_kraft = MAX(days.gym_kraft, excluded.gym_kraft),
          gym_kardio = MAX(days.gym_kardio, excluded.gym_kardio), updated_at = datetime('now')
        WHERE excluded.gym_kraft > days.gym_kraft OR excluded.gym_kardio > days.gym_kardio`).bind(rowsJson),
    ]);
  }
  if (!done) await markBackfill(env);
  return { days: dates.length, changed };
}

const markBackfill = env => env.DB.prepare(`INSERT INTO app_settings (key, value) VALUES ('gym_backfill_done', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(new Date().toISOString())).run();
