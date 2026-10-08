-- Vollständiges Schema (idempotent). Wird zusätzlich zur Laufzeit von lib/db.js sichergestellt.
CREATE TABLE IF NOT EXISTS days (
  entry_date TEXT PRIMARY KEY,
  gym_kraft INTEGER NOT NULL DEFAULT 0,
  gym_kardio INTEGER NOT NULL DEFAULT 0,
  walk_km REAL,
  steps INTEGER,
  calories_tracked INTEGER NOT NULL DEFAULT 0,
  calories_kcal INTEGER,
  protein_g INTEGER,
  water_ml INTEGER,
  beer_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS weight (
  entry_date TEXT PRIMARY KEY,
  weight_kg REAL,
  body_fat_pct REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goals (key TEXT PRIMARY KEY, value REAL);
CREATE TABLE IF NOT EXISTS sync_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  drive_file_id TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  modified_time TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sync_weight_readings (
  entry_date TEXT NOT NULL,
  reading_time TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  body_fat_pct REAL,
  UNIQUE(entry_date, reading_time, weight_kg)
);
CREATE INDEX IF NOT EXISTS idx_sync_weight_readings_date ON sync_weight_readings(entry_date);
CREATE TABLE IF NOT EXISTS sync_steps_daily (
  entry_date TEXT PRIMARY KEY,
  steps INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  steps_days INTEGER NOT NULL DEFAULT 0,
  weight_readings INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER NOT NULL DEFAULT 0,
  errors TEXT
);
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT
);
