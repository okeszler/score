import { downloadFile, FormatError, getAccessToken, listHealthFiles, parseNutritionCsv, parseStepsCsv, parseWeightCsv, rangeFromName } from '../../lib/drive.js';
import { json, handler, HttpError } from '../../lib/http.js';

const MAX_DOWNLOADS = 4; // pro Aufruf – große 30-Tage-Exporte kosten CPU-Zeit
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
  const report = { imported: [], skipped: 0, stepsDays: 0, weightReadings: 0, errors: [] };
  let downloads = 0;

  const markDone = (f, cat) => env.DB.prepare(`INSERT INTO sync_files (category, drive_file_id, file_name, modified_time)
    VALUES (?,?,?,?) ON CONFLICT(drive_file_id) DO UPDATE SET category = excluded.category,
      modified_time = excluded.modified_time, imported_at = datetime('now')`)
    .bind(cat, f.id, f.name, f.modifiedTime);

  for (const f of pending) {
    const range = rangeFromName(f.name);
    if (f.category === 'schritte' && range && covered.some(c => c.from <= range.from && c.to >= range.to)) {
      await markDone(f, 'schritte').run();
      report.skipped++;
      continue;
    }
    if (downloads >= MAX_DOWNLOADS) break;
    downloads++;
    try {
      const text = await downloadFile(token, f.id);
      const stmts = [];
      if (f.category === 'schritte') {
        const sums = parseStepsCsv(text);
        for (const [date, steps] of Object.entries(sums)) {
          // MAX: ein späterer Export enthält den Tag vollständiger als ein früherer
          stmts.push(env.DB.prepare(`INSERT INTO sync_steps_daily (entry_date, steps) VALUES (?, ?)
            ON CONFLICT(entry_date) DO UPDATE SET steps = MAX(steps, excluded.steps), updated_at = datetime('now')`).bind(date, steps));
        }
        report.stepsDays += stmts.length;
        if (range) covered.push(range);
        stmts.push(markDone(f, 'schritte'));
      } else if (f.category === 'ernaehrung') {
        const days = parseNutritionCsv(text);
        for (const [date, n] of Object.entries(days)) {
          // Neuester Export gewinnt (Mahlzeiten können in MyFitnessPal auch gelöscht werden)
          stmts.push(env.DB.prepare(`INSERT INTO sync_nutrition_daily (entry_date, kcal, protein_g, src_time) VALUES (?,?,?,?)
            ON CONFLICT(entry_date) DO UPDATE SET kcal = excluded.kcal, protein_g = excluded.protein_g,
              src_time = excluded.src_time, updated_at = datetime('now')
            WHERE excluded.src_time >= sync_nutrition_daily.src_time`).bind(date, n.kcal, n.protein, f.modifiedTime));
        }
        report.nutritionDays = (report.nutritionDays || 0) + Object.keys(days).length;
        stmts.push(markDone(f, 'ernaehrung'));
      } else {
        const rows = parseWeightCsv(text);
        for (const r of rows) {
          stmts.push(env.DB.prepare(`INSERT INTO sync_weight_readings
              (entry_date, reading_time, weight_kg, body_fat_pct, muscle_kg, body_water_kg, bmr_kcal)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(entry_date, reading_time, weight_kg) DO UPDATE SET
              body_fat_pct = COALESCE(body_fat_pct, excluded.body_fat_pct), muscle_kg = COALESCE(muscle_kg, excluded.muscle_kg),
              body_water_kg = COALESCE(body_water_kg, excluded.body_water_kg), bmr_kcal = COALESCE(bmr_kcal, excluded.bmr_kcal)`)
            .bind(r.entry_date, r.reading_time, r.weight_kg, r.body_fat_pct, r.muscle_kg, r.body_water_kg, r.bmr_kcal));
        }
        report.weightReadings += rows.length;
        stmts.push(markDone(f, WEIGHT_CAT));
      }
      await env.DB.batch(stmts);
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
