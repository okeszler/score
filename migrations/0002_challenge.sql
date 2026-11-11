-- Alkohol-Pause-Challenge (wird zusätzlich zur Laufzeit von lib/db.js sichergestellt, rein additiv)

-- Schnaps: 2-cl-Stamperl je Tag (Score: 1 Stamperl = 0,33 Bier)
ALTER TABLE days ADD COLUMN shots_count INTEGER NOT NULL DEFAULT 0;

-- Verlangen-Hilfe: "Ich habe Lust auf Alkohol"
CREATE TABLE IF NOT EXISTS cravings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,                 -- lokaler Kalendertag
  started_at TEXT NOT NULL,                 -- lokale Uhrzeit HH:MM
  level INTEGER,                            -- 1 (leicht) – 5 (sehr stark), optional
  triggers TEXT,                            -- JSON-Liste: stress, langeweile, hitze, abend
  completed INTEGER NOT NULL DEFAULT 0,     -- 10-Minuten-Timer durchgehalten
  drank INTEGER NOT NULL DEFAULT 0,         -- danach doch getrunken
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cravings_date ON cravings (entry_date);

-- Challenge-Einstellungen liegen als JSON in app_settings, Schlüssel 'challenge':
-- { "start": "YYYY-MM-DD", "check": "YYYY-MM-DD" }
