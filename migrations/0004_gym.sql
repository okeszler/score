-- Trainingstage aus dem Gym-Tracker (Binding GYM, nur lesend). Wird zusätzlich zur Laufzeit von lib/db.js angelegt.
-- Tageszusammenfassung der Sätze von 'Kratos' (Tag in Europe/Vienna); days.gym_kraft/gym_kardio werden daraus nur hochgesetzt.
CREATE TABLE IF NOT EXISTS gym_days (
  entry_date TEXT PRIMARY KEY,
  kraft INTEGER NOT NULL DEFAULT 0,       -- mind. ein Satz außerhalb der Gruppe 'Cardio'
  kardio INTEGER NOT NULL DEFAULT 0,      -- mind. ein Satz der Gruppe 'Cardio'
  saetze INTEGER NOT NULL DEFAULT 0,
  volumen REAL NOT NULL DEFAULT 0,        -- Summe gewicht × wdh der kg-Übungen
  cardio_min REAL NOT NULL DEFAULT 0,     -- Summe der Cardio-Minuten (einheit 'min')
  start TEXT,                             -- erster / letzter Satz (ISO-UTC)
  ende TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
