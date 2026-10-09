import { parseActivityCsv, parseBpCsv, parseNutritionCsv, parsePulseCsv, parseSleepCsv, parseStepsCsv, parseWeightCsv } from './drive.js';

// Alle Zeilen einer Datei als EIN Statement (json_each): spart D1-Abfragen pro Aufruf,
// und dank "WHERE … geändert" kosten unveränderte Zeilen keine Schreibvorgänge.
const J = (i) => `json_extract(value, '$[${i}]')`;

export function importStatement(db, f, text, report) {
  switch (f.category) {
    case 'schritte': {
      const rows = Object.entries(parseStepsCsv(text));
      report.stepsDays += rows.length;
      // MAX: ein späterer Export enthält den Tag vollständiger als ein früherer
      return rows.length && db.prepare(`INSERT INTO sync_steps_daily (entry_date, steps)
        SELECT ${J(0)}, ${J(1)} FROM json_each(?) WHERE true
        ON CONFLICT(entry_date) DO UPDATE SET steps = excluded.steps, updated_at = datetime('now')
        WHERE excluded.steps > sync_steps_daily.steps`).bind(JSON.stringify(rows));
    }
    case 'ernaehrung': {
      const rows = Object.entries(parseNutritionCsv(text)).map(([d, n]) => [d, n.kcal, n.protein]);
      report.nutritionDays += rows.length;
      // Neuester Export gewinnt (Mahlzeiten können in MyFitnessPal auch gelöscht werden)
      return rows.length && db.prepare(`INSERT INTO sync_nutrition_daily (entry_date, kcal, protein_g, src_time)
        SELECT ${J(0)}, ${J(1)}, ${J(2)}, ?2 FROM json_each(?1) WHERE true
        ON CONFLICT(entry_date) DO UPDATE SET kcal = excluded.kcal, protein_g = COALESCE(excluded.protein_g, sync_nutrition_daily.protein_g),
          src_time = excluded.src_time, updated_at = datetime('now')
        WHERE excluded.src_time >= sync_nutrition_daily.src_time
          AND (excluded.kcal IS NOT sync_nutrition_daily.kcal OR (excluded.protein_g IS NOT NULL AND excluded.protein_g IS NOT sync_nutrition_daily.protein_g))`)
        .bind(JSON.stringify(rows), f.modifiedTime);
    }
    case 'gewicht': {
      const rows = parseWeightCsv(text).map(r => [r.entry_date, r.reading_time, r.weight_kg, r.body_fat_pct, r.muscle_kg, r.body_water_kg, r.bmr_kcal]);
      report.weightReadings += rows.length;
      return rows.length && db.prepare(`INSERT INTO sync_weight_readings
          (entry_date, reading_time, weight_kg, body_fat_pct, muscle_kg, body_water_kg, bmr_kcal)
        SELECT ${J(0)}, ${J(1)}, ${J(2)}, ${J(3)}, ${J(4)}, ${J(5)}, ${J(6)} FROM json_each(?) WHERE true
        ON CONFLICT(entry_date, reading_time, weight_kg) DO UPDATE SET
          body_fat_pct = COALESCE(body_fat_pct, excluded.body_fat_pct), muscle_kg = COALESCE(muscle_kg, excluded.muscle_kg),
          body_water_kg = COALESCE(body_water_kg, excluded.body_water_kg), bmr_kcal = COALESCE(bmr_kcal, excluded.bmr_kcal)
        WHERE (body_fat_pct IS NULL AND excluded.body_fat_pct IS NOT NULL) OR (muscle_kg IS NULL AND excluded.muscle_kg IS NOT NULL)
           OR (body_water_kg IS NULL AND excluded.body_water_kg IS NOT NULL) OR (bmr_kcal IS NULL AND excluded.bmr_kcal IS NOT NULL)`)
        .bind(JSON.stringify(rows));
    }
    case 'puls': {
      const rows = [];
      for (const [d, hours] of Object.entries(parsePulseCsv(text))) {
        for (const [h, v] of Object.entries(hours)) rows.push([d, Number(h), v.n, Math.round((v.sum / v.n) * 10) / 10, v.min, v.max]);
      }
      report.pulseHours += rows.length;
      // Mehr Messungen = vollständigerer Export -> gewinnt
      return rows.length && db.prepare(`INSERT INTO sync_pulse_hourly (entry_date, hour, n, avg_bpm, min_bpm, max_bpm)
        SELECT ${J(0)}, ${J(1)}, ${J(2)}, ${J(3)}, ${J(4)}, ${J(5)} FROM json_each(?) WHERE true
        ON CONFLICT(entry_date, hour) DO UPDATE SET n = excluded.n, avg_bpm = excluded.avg_bpm,
          min_bpm = excluded.min_bpm, max_bpm = excluded.max_bpm
        WHERE excluded.n > sync_pulse_hourly.n`).bind(JSON.stringify(rows));
    }
    case 'schlaf': {
      const rows = parseSleepCsv(text).map(r => [r.start, r.seconds, r.stage]);
      report.sleepSegments += rows.length;
      return rows.length && db.prepare(`INSERT INTO sync_sleep_segments (start_ts, seconds, stage)
        SELECT ${J(0)}, ${J(1)}, ${J(2)} FROM json_each(?) WHERE true
        ON CONFLICT(start_ts) DO UPDATE SET seconds = excluded.seconds, stage = excluded.stage
        WHERE excluded.seconds IS NOT sync_sleep_segments.seconds OR excluded.stage IS NOT sync_sleep_segments.stage`)
        .bind(JSON.stringify(rows));
    }
    case 'blutdruck': {
      const rows = parseBpCsv(text).map(r => [r.entry_date, r.reading_time, r.systolic, r.diastolic, r.pulse, r.note]);
      report.bloodPressure += rows.length;
      return rows.length && db.prepare(`INSERT INTO blood_pressure (entry_date, reading_time, systolic, diastolic, pulse, note, source)
        SELECT ${J(0)}, ${J(1)}, ${J(2)}, ${J(3)}, ${J(4)}, ${J(5)}, 'sync' FROM json_each(?) WHERE true
        ON CONFLICT(entry_date, reading_time, systolic, diastolic) DO UPDATE SET pulse = excluded.pulse, note = excluded.note
        WHERE excluded.pulse IS NOT blood_pressure.pulse OR excluded.note IS NOT blood_pressure.note`).bind(JSON.stringify(rows));
    }
    case 'aktivitaeten': {
      const rows = parseActivityCsv(text).map(r => [r.entry_date, r.start_time, r.activity_type, r.source_app, r.elapsed_seconds,
        r.active_seconds, r.distance_km, r.calories, r.steps, r.avg_hr, r.max_hr]);
      report.activities += rows.length;
      return rows.length && db.prepare(`INSERT INTO sync_activities (entry_date, start_time, activity_type, source_app,
          elapsed_seconds, active_seconds, distance_km, calories, steps, avg_hr, max_hr)
        SELECT ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(J).join(', ')} FROM json_each(?) WHERE true
        ON CONFLICT(entry_date, start_time, activity_type) DO UPDATE SET source_app = excluded.source_app,
          elapsed_seconds = excluded.elapsed_seconds, active_seconds = excluded.active_seconds, distance_km = excluded.distance_km,
          calories = excluded.calories, steps = excluded.steps, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr
        WHERE excluded.elapsed_seconds IS NOT sync_activities.elapsed_seconds OR excluded.calories IS NOT sync_activities.calories
           OR excluded.distance_km IS NOT sync_activities.distance_km OR excluded.avg_hr IS NOT sync_activities.avg_hr`).bind(JSON.stringify(rows));
    }
    default:
      return null;
  }
}
