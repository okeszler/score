import { downloadFile, FormatError, getAccessToken, listHealthFiles, rangeFromName } from '../../lib/drive.js';
import { importStatement } from '../../lib/importers.js';
import { json, handler, HttpError } from '../../lib/http.js';
import { addDays } from '../../public/assets/score.js';

const MAX_DOWNLOADS = 10; // pro Aufruf
const MAX_BYTES = 3_000_000; // große 30-Tage-Exporte (Puls ~0,9 MB) kosten CPU-Zeit
// Kategorien mit rollierenden 30-Tage-Exporten: ältere, vollständig abgedeckte Dateien überspringen
const RANGE_CATS = new Set(['schritte', 'puls', 'schlaf']);
const WEIGHT_CAT = 'gewicht3'; // v3: auch Muskelmasse, Körperwasser, Grundumsatz (ältere Imports werden einmal nachgeholt)
const STEPS_CAT = 'schritte2'; // v2: Uhr/Handy nicht doppelt zählen (ältere Imports werden einmal neu berechnet)
// Kategorie, unter der eine verarbeitete Datei gespeichert wird (Versionsstand der Import-Regel)
const doneCat = f => (f.category === 'gewicht' ? WEIGHT_CAT : f.category === 'schritte' ? STEPS_CAT : f.category);

export const onRequestGet = handler(async ({ env }) => {
  const last = await env.DB.prepare('SELECT MAX(imported_at) AS at, COUNT(*) AS n FROM sync_files').first();
  const lastSteps = await env.DB.prepare('SELECT MAX(entry_date) AS d FROM sync_steps_daily').first();
  const lastWeight = await env.DB.prepare('SELECT MAX(entry_date) AS d FROM sync_weight_readings').first();
  const lastRun = await env.DB.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').first();
  return json({
    lastRun: lastRun ? { ...lastRun, errors: lastRun.errors ? JSON.parse(lastRun.errors) : [] } : null,
    configured: !!env.GOOGLE_SERVICE_ACCOUNT_JSON,
    lastImport: last?.at ?? null,
    files: last?.n ?? 0,
    lastStepsDate: lastSteps?.d ?? null,
    lastWeightDate: lastWeight?.d ?? null,
  });
});

// Jeder Lauf (manuell oder Cron) wird in sync_log protokolliert – auch wenn er komplett scheitert.
export const onRequestPost = handler(async ({ request, env }) => {
  const source = request.headers.has('Authorization') ? 'cron' : 'manuell';
  let report;
  try {
    report = await runSync(env);
  } catch (e) {
    await log(env, source, { imported: [], skipped: 0, stepsDays: 0, weightReadings: 0, remaining: 0, errors: [e.message] });
    throw e;
  }
  await log(env, source, report);
  return json(report);
});

async function log(env, source, r) {
  await env.DB.prepare(`INSERT INTO sync_log (source, imported, skipped, steps_days, weight_readings, remaining, errors)
    VALUES (?,?,?,?,?,?,?)`).bind(source, r.imported.length, r.skipped, r.stepsDays, r.weightReadings, r.remaining,
    r.errors.length ? JSON.stringify(r.errors) : null).run();
  // Protokoll klein halten
  await env.DB.prepare('DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 200)').run();
}

async function runSync(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new HttpError('Google Service Account ist nicht konfiguriert', 503);
  const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const files = await listHealthFiles(token);

  // Health Sync legt Dateien bei jeder Aktualisierung neu an (neue Drive-ID). Einträge zu Dateien,
  // die es in Drive nicht mehr gibt, entfernen – sonst wächst die Tabelle um >100 Zeilen pro Tag.
  if (files.length) {
    await env.DB.prepare('DELETE FROM sync_files WHERE drive_file_id NOT IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(files.map(f => f.id))).run();
  }
  const { results: known } = await env.DB.prepare('SELECT drive_file_id, category, modified_time FROM sync_files').all();
  const done = new Map(known.map(k => [k.drive_file_id, k]));
  const pending = files.filter(f => {
    const k = done.get(f.id);
    if (!k) return true;
    if (k.category === 'fehler') return false;
    // Datei wurde seit dem Import überschrieben (Tagesdatei wird laufend aktualisiert)
    if (k.modified_time && f.modifiedTime > k.modified_time) return true;
    return k.category !== doneCat(f);
  });

  // Neueste zuerst. Ein Schritte-Export, dessen Zeitraum vollständig in einem neueren,
  // bereits verarbeiteten Export liegt, muss nicht heruntergeladen werden.
  pending.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  const covered = [];
  await orderStepsBackfill(env, pending);
  const report = { imported: [], skipped: 0, stepsDays: 0, weightReadings: 0, nutritionDays: 0, pulseHours: 0, sleepSegments: 0, bloodPressure: 0, activities: 0, errors: [] };
  let downloads = 0;

  const markDone = (f, cat) => env.DB.prepare(`INSERT INTO sync_files (category, drive_file_id, file_name, modified_time)
    VALUES (?,?,?,?) ON CONFLICT(drive_file_id) DO UPDATE SET category = excluded.category,
      modified_time = excluded.modified_time, imported_at = datetime('now')`)
    .bind(cat, f.id, f.name, f.modifiedTime);

  let bytes = 0;
  const skips = [];
  for (const f of pending) {
    const range = rangeFromName(f.name);
    if (f.skipSteps || (RANGE_CATS.has(f.category) && range && covered.some(c => c.cat === f.category && c.from <= range.from && c.to >= range.to))) {
      skips.push(markDone(f, doneCat(f))); // gesammelt: bei der Neuberechnung können es >100 sein
      report.skipped++;
      continue;
    }
    const size = Number(f.size) || 0;
    if (downloads >= MAX_DOWNLOADS || (downloads > 0 && bytes + size > MAX_BYTES)) break;
    downloads++;
    bytes += size;
    try {
      const text = await downloadFile(token, f.id);
      const stmt = importStatement(env.DB, f, text, report);
      await env.DB.batch([...(stmt ? [stmt] : []), markDone(f, doneCat(f))]);
      if (RANGE_CATS.has(f.category) && range) covered.push({ cat: f.category, ...range });
      report.imported.push(f.name);
    } catch (e) {
      // Datei wurde zwischen Auflisten und Download von Health Sync ersetzt: kein Fehler, nächster Lauf holt die neue
      if (/\(404\)/.test(e.message)) { report.skipped++; continue; }
      report.errors.push(`${f.name}: ${e.message}`);
      // Dauerhaft unlesbare Datei (falsches Format) nicht bei jedem Lauf erneut versuchen
      if (e instanceof FormatError) await markDone(f, 'fehler').run();
    }
  }

  for (let i = 0; i < skips.length; i += 100) await env.DB.batch(skips.slice(i, i + 100));
  const processed = report.imported.length + report.skipped + report.errors.length;
  report.remaining = Math.max(0, pending.length - processed);
  return report;
}

/**
 * Schritte neu berechnen (neue Zählregel): Tage mit src_time sind schon nach der neuen Regel importiert.
 * Alte 30-Tage-Exporte (jeden Tag einer, um einen Tag versetzt) werden nicht alle geladen, sondern
 * gierig nur die, die noch offene Tage abdecken (≈ 1 von 30); die übrigen werden als erledigt markiert,
 * indem sie ans Ende rücken und über `skipSteps` übersprungen werden. Aktuelle Dateien (letzte 2 Tage)
 * bleiben unberührt vorn – deren Inhalt ändert sich laufend.
 */
async function orderStepsBackfill(env, pending) {
  const cutoff = addDays(new Date().toISOString().slice(0, 10), -2);
  const isOld = f => f.category === 'schritte' && rangeFromName(f.name) && rangeFromName(f.name).to < cutoff;
  const old = pending.filter(isOld);
  if (!old.length) return;
  const { results } = await env.DB.prepare('SELECT entry_date FROM sync_steps_daily WHERE src_time IS NOT NULL').all();
  const have = new Set(results.map(r => r.entry_date));
  const days = f => { const r = rangeFromName(f.name), out = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d); return out; };
  const chosen = [], rest = [...old];
  for (;;) {
    let best = null, bestN = 0;
    for (const f of rest) {
      const n = days(f).filter(d => !have.has(d)).length;
      if (n > bestN || (n === bestN && n > 0 && f.modifiedTime > best.modifiedTime)) { best = f; bestN = n; }
    }
    if (!best) break;
    chosen.push(best);
    rest.splice(rest.indexOf(best), 1);
    days(best).forEach(d => have.add(d));
  }
  for (const f of rest) f.skipSteps = true; // vollständig abgedeckt
  const recent = pending.filter(f => !isOld(f));
  pending.splice(0, pending.length, ...recent, ...chosen, ...rest);
}
