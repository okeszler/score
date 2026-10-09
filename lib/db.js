import { DEFAULT_GOALS, mergeGoals } from '../public/assets/score.js';

const schemaReady = new WeakSet(); // pro DB-Binding (einmal pro Isolate)

/**
 * Legt fehlende Tabellen/Spalten an (idempotent, einmal pro Isolate).
 * Bestehende Daten der alten App bleiben unverändert.
 */
export async function ensureSchema(db) {
  if (schemaReady.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS days (
      entry_date TEXT PRIMARY KEY, gym_kraft INTEGER NOT NULL DEFAULT 0, gym_kardio INTEGER NOT NULL DEFAULT 0,
      walk_km REAL, steps INTEGER, calories_tracked INTEGER NOT NULL DEFAULT 0, calories_kcal INTEGER,
      protein_g INTEGER, water_ml INTEGER, beer_count INTEGER NOT NULL DEFAULT 0, note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS weight (
      entry_date TEXT PRIMARY KEY, weight_kg REAL, body_fat_pct REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS goals (key TEXT PRIMARY KEY, value REAL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, drive_file_id TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL, modified_time TEXT, imported_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_weight_readings (
      entry_date TEXT NOT NULL, reading_time TEXT NOT NULL, weight_kg REAL NOT NULL,
      UNIQUE(entry_date, reading_time, weight_kg))`),
    // Neu: Tagessummen statt Einzelmessungen (rollierende 30-Tage-Exporte überlappen sich)
    // Ernährung aus MyFitnessPal; src_time = modifiedTime der Quelldatei (neuester Export gewinnt)
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_nutrition_daily (
      entry_date TEXT PRIMARY KEY, kcal INTEGER, protein_g INTEGER, src_time TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    // ---- Gesundheit (aus dem Health Tracker übernommen) ----
    db.prepare(`CREATE TABLE IF NOT EXISTS blood_pressure (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_date TEXT NOT NULL, reading_time TEXT NOT NULL DEFAULT '',
      systolic INTEGER NOT NULL, diastolic INTEGER NOT NULL, pulse INTEGER, note TEXT, source TEXT NOT NULL DEFAULT 'manuell',
      UNIQUE(entry_date, reading_time, systolic, diastolic))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lab_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_date TEXT NOT NULL, test_name TEXT NOT NULL, value REAL NOT NULL,
      unit TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    // Puls als Stundenwerte statt Einzelmessungen (~24 statt ~750 Zeilen pro Tag)
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_pulse_hourly (
      entry_date TEXT NOT NULL, hour INTEGER NOT NULL, n INTEGER NOT NULL, avg_bpm REAL NOT NULL,
      min_bpm INTEGER NOT NULL, max_bpm INTEGER NOT NULL, PRIMARY KEY (entry_date, hour)) WITHOUT ROWID`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_sleep_segments (
      start_ts TEXT PRIMARY KEY, seconds INTEGER NOT NULL, stage TEXT) WITHOUT ROWID`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_date TEXT NOT NULL, start_time TEXT, activity_type TEXT, source_app TEXT,
      elapsed_seconds INTEGER, active_seconds INTEGER, distance_km REAL, calories REAL, steps INTEGER, avg_hr REAL, max_hr REAL,
      UNIQUE(entry_date, start_time, activity_type))`),
    // Oberflächen-Einstellungen (z. B. Reihenfolge der Kacheln), geräteübergreifend
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id TEXT PRIMARY KEY, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
      label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT NOT NULL,
      imported INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, steps_days INTEGER NOT NULL DEFAULT 0,
      weight_readings INTEGER NOT NULL DEFAULT 0, remaining INTEGER NOT NULL DEFAULT 0, errors TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_steps_daily (
      entry_date TEXT PRIMARY KEY, steps INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
  ]);
  // Manuelle Körperzusammensetzung (wie in Samsung Health angezeigt, in kg)
  const wcols = await db.prepare(`PRAGMA table_info(weight)`).all();
  for (const col of ['muscle_kg', 'body_water_kg']) {
    if (!wcols.results.some(c => c.name === col)) await db.prepare(`ALTER TABLE weight ADD COLUMN ${col} REAL`).run();
  }
  const cols = await db.prepare(`PRAGMA table_info(sync_weight_readings)`).all();
  // Körperzusammensetzung (Samsung Health → Health Connect → Health Sync)
  for (const col of ['body_fat_pct', 'muscle_kg', 'body_water_kg', 'bmr_kcal']) {
    if (!cols.results.some(c => c.name === col)) {
      await db.prepare(`ALTER TABLE sync_weight_readings ADD COLUMN ${col} REAL`).run();
    }
  }
  // Einmalige Übernahme der Einzelmessungen der alten App
  const old = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_steps_readings'`).first();
  if (old) {
    await db.prepare(`INSERT OR IGNORE INTO sync_steps_daily (entry_date, steps)
      SELECT entry_date, SUM(steps) FROM sync_steps_readings GROUP BY entry_date`).run();
  }
  schemaReady.add(db);
}

export async function getGoals(db) {
  const { results } = await db.prepare('SELECT key, value FROM goals').all();
  const raw = Object.fromEntries(results.map(r => [r.key, r.value]));
  return mergeGoals(raw);
}

const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Tägliche Gewichtsreihe: manueller Eintrag hat Vorrang, sonst die erste
 * Sync-Messung des Tages (morgens, nüchtern = am vergleichbarsten).
 */
export async function getWeights(db, from = '0000-00-00', to = '9999-12-31') {
  const [manual, synced] = await db.batch([
    db.prepare('SELECT entry_date, weight_kg, body_fat_pct, muscle_kg, body_water_kg FROM weight WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date').bind(from, to),
    db.prepare(`SELECT entry_date, reading_time, weight_kg, body_fat_pct, muscle_kg, body_water_kg, bmr_kcal FROM sync_weight_readings
      WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date, reading_time`).bind(from, to),
  ]);
  const byDate = {};
  for (const r of synced.results) {
    const d = (byDate[r.entry_date] ||= { entry_date: r.entry_date, weight_kg: null, body_fat_pct: null, muscle_kg: null, body_water_kg: null, bmr_kcal: null, source: 'sync' });
    if (d.muscle_kg == null && r.muscle_kg > 0) d.muscle_kg = round1(r.muscle_kg);
    if (d.body_water_kg == null && r.body_water_kg > 0) d.body_water_kg = round1(r.body_water_kg);
    if (d.bmr_kcal == null && r.bmr_kcal > 0) d.bmr_kcal = Math.round(r.bmr_kcal);
    if (d.weight_kg == null) d.weight_kg = round1(r.weight_kg);
    if (d.body_fat_pct == null && r.body_fat_pct > 0) d.body_fat_pct = round1(r.body_fat_pct);
  }
  for (const r of manual.results) {
    const d = (byDate[r.entry_date] ||= { entry_date: r.entry_date, weight_kg: null, body_fat_pct: null, muscle_kg: null, body_water_kg: null, bmr_kcal: null });
    d.source = 'manual';
    if (r.weight_kg != null) d.weight_kg = round1(r.weight_kg);
    if (r.body_fat_pct != null) d.body_fat_pct = round1(r.body_fat_pct);
    if (r.muscle_kg != null) d.muscle_kg = round1(r.muscle_kg);
    if (r.body_water_kg != null) d.body_water_kg = round1(r.body_water_kg);
  }
  return Object.values(byDate).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
}

export async function getDays(db, from, to) {
  const [days, synced, food] = await db.batch([
    db.prepare('SELECT * FROM days WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date').bind(from, to),
    db.prepare('SELECT entry_date, steps FROM sync_steps_daily WHERE entry_date BETWEEN ? AND ?').bind(from, to),
    db.prepare('SELECT entry_date, kcal, protein_g FROM sync_nutrition_daily WHERE entry_date BETWEEN ? AND ?').bind(from, to),
  ]);
  const syncMap = Object.fromEntries(synced.results.map(r => [r.entry_date, r.steps]));
  const foodMap = Object.fromEntries(food.results.map(r => [r.entry_date, { kcal: r.kcal, protein: r.protein_g }]));
  const out = days.results.map(d => ({
    ...d,
    synced_steps: syncMap[d.entry_date] ?? null,
    synced_kcal: foodMap[d.entry_date]?.kcal ?? null,
    synced_protein: foodMap[d.entry_date]?.protein ?? null,
  }));
  return { days: out, synced: syncMap, food: foodMap };
}

export { DEFAULT_GOALS };
