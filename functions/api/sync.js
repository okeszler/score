import { downloadFile, FormatError, getAccessToken, listHealthFiles, rangeFromName } from '../../lib/drive.js';
import { importStatement } from '../../lib/importers.js';
import { json, handler, HttpError } from '../../lib/http.js';

const MAX_DOWNLOADS = 10; // pro Aufruf
const MAX_BYTES = 3_000_000; // große 30-Tage-Exporte (Puls ~0,9 MB) kosten CPU-Zeit
// Kategorien mit rollierenden 30-Tage-Exporten: ältere, vollständig abgedeckte Dateien überspringen
const RANGE_CATS = new Set(['schritte', 'puls', 'schlaf']);
const WEIGHT_CAT = 'gewicht3'; // v3: auch Muskelmasse, Körperwasser, Grundumsatz (ältere Imports werden einmal nachgeholt)

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

  const { results: known } = await env.DB.prepare('SELECT drive_file_id, category, modified_time FROM sync_files').all();
  const done = new Map(known.map(k => [k.drive_file_id, k]));
  const pending = files.filter(f => {
    const k = done.get(f.id);
    if (!k) return true;
    if (k.category === 'fehler') return false;
    // Datei wurde seit dem Import überschrieben (Tagesdatei wird laufend aktualisiert)
    if (k.modified_time && f.modifiedTime > k.modified_time) return true;
    return f.category === 'gewicht' && k.category !== WEIGHT_CAT;
  });

  // Neueste zuerst. Ein Schritte-Export, dessen Zeitraum vollständig in einem neueren,
  // bereits verarbeiteten Export liegt, muss nicht heruntergeladen werden.
  pending.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  const covered = [];
  const report = { imported: [], skipped: 0, stepsDays: 0, weightReadings: 0, nutritionDays: 0, pulseHours: 0, sleepSegments: 0, bloodPressure: 0, activities: 0, errors: [] };
  let downloads = 0;

  const markDone = (f, cat) => env.DB.prepare(`INSERT INTO sync_files (category, drive_file_id, file_name, modified_time)
    VALUES (?,?,?,?) ON CONFLICT(drive_file_id) DO UPDATE SET category = excluded.category,
      modified_time = excluded.modified_time, imported_at = datetime('now')`)
    .bind(cat, f.id, f.name, f.modifiedTime);

  let bytes = 0;
  for (const f of pending) {
    const range = rangeFromName(f.name);
    if (RANGE_CATS.has(f.category) && range && covered.some(c => c.cat === f.category && c.from <= range.from && c.to >= range.to)) {
      await markDone(f, f.category).run();
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
      await env.DB.batch([...(stmt ? [stmt] : []), markDone(f, f.category === 'gewicht' ? WEIGHT_CAT : f.category)]);
      if (RANGE_CATS.has(f.category) && range) covered.push({ cat: f.category, ...range });
      report.imported.push(f.name);
    } catch (e) {
      report.errors.push(`${f.name}: ${e.message}`);
      // Dauerhaft unlesbare Datei (falsches Format) nicht bei jedem Lauf erneut versuchen
      if (e instanceof FormatError) await markDone(f, 'fehler').run();
    }
  }

  const processed = report.imported.length + report.skipped + report.errors.length;
  report.remaining = Math.max(0, pending.length - processed);
  return report;
}
