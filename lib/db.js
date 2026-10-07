import { DEFAULT_GOALS, mergeGoals } from '../public/assets/score.js';

let schemaReady = false;

/**
 * Legt fehlende Tabellen/Spalten an (idempotent, einmal pro Isolate).
 * Bestehende Daten der alten App bleiben unverändert.
 */
export async function ensureSchema(db) {
  if (schemaReady) return;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_steps_daily (
      entry_date TEXT PRIMARY KEY, steps INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
  ]);
  const cols = await db.prepare(`PRAGMA table_info(sync_weight_readings)`).all();
  if (!cols.results.some(c => c.name === 'body_fat_pct')) {
    await db.prepare(`ALTER TABLE sync_weight_readings ADD COLUMN body_fat_pct REAL`).run();
  }
  // Einmalige Übernahme der Einzelmessungen der alten App
  const old = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_steps_readings'`).first();
  if (old) {
    await db.prepare(`INSERT OR IGNORE INTO sync_steps_daily (entry_date, steps)
      SELECT entry_date, SUM(steps) FROM sync_steps_readings GROUP BY entry_date`).run();
  }
  schemaReady = true;
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
    db.prepare('SELECT entry_date, weight_kg, body_fat_pct FROM weight WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date').bind(from, to),
    db.prepare(`SELECT entry_date, reading_time, weight_kg, body_fat_pct FROM sync_weight_readings
      WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date, reading_time`).bind(from, to),
  ]);
  const byDate = {};
  for (const r of synced.results) {
    const d = (byDate[r.entry_date] ||= { entry_date: r.entry_date, weight_kg: null, body_fat_pct: null, source: 'sync' });
    if (d.weight_kg == null) d.weight_kg = round1(r.weight_kg);
    if (d.body_fat_pct == null && r.body_fat_pct > 0) d.body_fat_pct = round1(r.body_fat_pct);
  }
  for (const r of manual.results) {
    const d = (byDate[r.entry_date] ||= { entry_date: r.entry_date, weight_kg: null, body_fat_pct: null });
    d.source = 'manual';
    if (r.weight_kg != null) d.weight_kg = round1(r.weight_kg);
    if (r.body_fat_pct != null) d.body_fat_pct = round1(r.body_fat_pct);
  }
  return Object.values(byDate).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
}

export async function getDays(db, from, to) {
  const [days, synced] = await db.batch([
    db.prepare('SELECT * FROM days WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date').bind(from, to),
    db.prepare('SELECT entry_date, steps FROM sync_steps_daily WHERE entry_date BETWEEN ? AND ?').bind(from, to),
  ]);
  const syncMap = Object.fromEntries(synced.results.map(r => [r.entry_date, r.steps]));
  const out = days.results.map(d => ({ ...d, synced_steps: syncMap[d.entry_date] ?? null }));
  return { days: out, synced: syncMap };
}

export { DEFAULT_GOALS };
