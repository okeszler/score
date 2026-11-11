-- "Info des Tages" (wird zusätzlich zur Laufzeit von lib/db.js sichergestellt, rein additiv).
-- Inhalte kommen aus content/info_tips.json und werden beim Start automatisch übernommen,
-- sobald sich dort "version" ändert (Schlüssel 'info_seed_version' in app_settings).

CREATE TABLE IF NOT EXISTS info_tips (
  id INTEGER PRIMARY KEY,                -- feste IDs aus der Seed-Datei
  kategorie TEXT NOT NULL,               -- folgen, abstinenz, training, motivation, verlangen, alternativen, soziales
  streak_tag INTEGER,                    -- Vorrang an diesem Streak-Tag (z. B. 3, 7, 14, 28), sonst NULL
  titel TEXT NOT NULL,
  kurz TEXT NOT NULL,                    -- 2–4 Sätze
  lang TEXT,                             -- optional "Mehr lesen"
  quelle TEXT,                           -- nur echte, prüfbare Quelle, sonst NULL
  aktiv INTEGER NOT NULL DEFAULT 1
);

-- Jede gezeigte Info eines Tages (erste = Info des Tages); gelesen = 1 nach "Gelesen" (+1 Bonuspunkt pro Tag)
CREATE TABLE IF NOT EXISTS info_reads (
  entry_date TEXT NOT NULL,
  tip_id INTEGER NOT NULL,
  gelesen INTEGER NOT NULL DEFAULT 0,
  shown_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entry_date, tip_id)
);
CREATE INDEX IF NOT EXISTS info_reads_tip ON info_reads (tip_id, entry_date);
