import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { ensureSchema } from '../lib/db.js';
import { aggregateGym, importGym, localDay } from '../lib/gym.js';
import { isConfirmed, scoreDay, withProvisionalDays } from '../public/assets/score.js';

// Gym-Tracker-Datenbank nachgebaut (Schema wie gymtracker-db)
function gymDb(rows) {
  const db = createD1();
  db.raw.exec(`CREATE TABLE uebungen (name TEXT PRIMARY KEY, schritt REAL NOT NULL DEFAULT 1, start REAL NOT NULL DEFAULT 0,
      aktiv INTEGER NOT NULL DEFAULT 1, einheit TEXT NOT NULL DEFAULT 'kg', gruppe TEXT NOT NULL DEFAULT 'Sonstiges', ziel_wdh INTEGER NOT NULL DEFAULT 10);
    CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, person TEXT NOT NULL, uebung TEXT NOT NULL,
      gewicht REAL NOT NULL, wdh REAL NOT NULL, client_id TEXT);
    INSERT INTO uebungen (name, gruppe, einheit) VALUES ('Chest Press', 'Torso', 'kg'), ('Leg Press', 'Beine', 'kg'),
      ('Treadmill', 'Cardio', 'min'), ('Curl', 'Arme', 'kg');`);
  for (const [ts, person, uebung, gewicht, wdh] of rows) {
    db.raw.prepare('INSERT INTO log (ts, person, uebung, gewicht, wdh) VALUES (?,?,?,?,?)').run(ts, person, uebung, gewicht, wdh);
  }
  return db;
}
const NOW = new Date('2026-11-16T12:00:00Z');

test('Zeitzonen-Grenze: Tag in Europe/Vienna (Winter und Sommer)', () => {
  assert.equal(localDay('2026-11-15T22:59:00.000Z'), '2026-11-15'); // 23:59 Ortszeit (MEZ)
  assert.equal(localDay('2026-11-15T23:30:00.000Z'), '2026-11-16'); // 00:30 Ortszeit -> neuer Tag
  assert.equal(localDay('2026-07-22T21:59:00.000Z'), '2026-07-22'); // 23:59 MESZ
  assert.equal(localDay('2026-07-22T22:30:00.000Z'), '2026-07-23'); // 00:30 MESZ
  assert.equal(localDay('2026-03-29T00:30:00.000Z'), '2026-03-29'); // Umstellungsnacht
});

test('Kraft/Kardio-Zuordnung, Sätze, Volumen (nur kg), Cardio-Minuten', () => {
  const a = aggregateGym([
    { ts: '2026-11-14T09:05:00.000Z', gewicht: 50, wdh: 10, gruppe: 'Torso', einheit: 'kg' },
    { ts: '2026-11-14T09:10:00.000Z', gewicht: 50, wdh: 8, gruppe: 'Torso', einheit: 'kg' },
    { ts: '2026-11-14T10:20:00.000Z', gewicht: 20, wdh: 1, gruppe: 'Cardio', einheit: 'min' },
    { ts: '2026-11-15T18:00:00.000Z', gewicht: 15, wdh: 1, gruppe: 'Cardio', einheit: 'min' },   // nur Cardio
    { ts: '2026-11-16T18:00:00.000Z', gewicht: 10, wdh: 12, gruppe: 'Sonstiges', einheit: 'kg' }, // Sonstiges = Kraft
    { ts: '2026-11-16T18:05:00.000Z', gewicht: 10, wdh: 12, gruppe: null, einheit: null },         // gelöschte Übung = Kraft
  ]);
  assert.deepEqual(a['2026-11-14'], { kraft: 1, kardio: 1, saetze: 3, volumen: 900, cardio_min: 20, start: '2026-11-14T09:05:00.000Z', ende: '2026-11-14T10:20:00.000Z' });
  assert.deepEqual([a['2026-11-15'].kraft, a['2026-11-15'].kardio, a['2026-11-15'].volumen], [0, 1, 0]);
  assert.deepEqual([a['2026-11-16'].kraft, a['2026-11-16'].kardio, a['2026-11-16'].volumen], [1, 0, 240]);
});

test('Import: nur Kratos, nur hochsetzen, bestätigt nicht, Score bekommt Training, idempotent', async () => {
  const DB = createD1();
  await ensureSchema(DB);
  const GYM = gymDb([
    ['2026-11-14T09:05:00.000Z', 'Kratos', 'Chest Press', 50, 10],
    ['2026-11-14T10:20:00.000Z', 'Kratos', 'Treadmill', 20, 1],
    ['2026-11-15T23:30:00.000Z', 'Kratos', 'Leg Press', 80, 10],   // 00:30 am 16.11.
    ['2026-11-13T17:00:00.000Z', 'Atreus', 'Curl', 10, 10],        // Sohn: ignoriert
  ]);
  // 14.11.: bestätigt, Kardio von Hand gesetzt; 13.11.: nur Atreus
  await DB.prepare(`INSERT INTO days (entry_date, gym_kraft, gym_kardio, beer_count, confirmed) VALUES ('2026-11-14', 0, 1, 0, 1)`).run();
  const r = await importGym({ DB, GYM }, { now: NOW });
  assert.deepEqual(r.changed.sort(), ['2026-11-14', '2026-11-16']);
  const rows = Object.fromEntries((await DB.prepare('SELECT * FROM days').all()).results.map(x => [x.entry_date, x]));
  assert.equal(rows['2026-11-13'], undefined);
  assert.deepEqual([rows['2026-11-14'].gym_kraft, rows['2026-11-14'].gym_kardio, rows['2026-11-14'].confirmed], [1, 1, 1]);
  // neuer Tag: Training gesetzt, aber NICHT bestätigt -> vorläufig, Training zählt im vorläufigen Score
  const d16 = rows['2026-11-16'];
  assert.deepEqual([d16.gym_kraft, d16.gym_kardio, d16.confirmed], [1, 0, 0]);
  const days = withProvisionalDays({ '2026-11-16': d16 }, { '2026-11-16': 3000 }, {}, '2026-11-16');
  assert.equal(isConfirmed(days['2026-11-16']), false);
  assert.equal(scoreDay(days['2026-11-16'], {}).parts.bewegung, 1); // 3.000 Schritte = 0, Training +1
  // idempotent: zweiter Lauf schreibt nichts
  assert.deepEqual((await importGym({ DB, GYM }, { now: NOW })).changed, []);
  // von Hand abgewählt -> bleibt abgewählt, solange keine neuen Sätze dazukommen
  await DB.prepare(`UPDATE days SET gym_kraft = 0 WHERE entry_date = '2026-11-14'`).run();
  await importGym({ DB, GYM }, { now: NOW });
  assert.equal((await DB.prepare(`SELECT gym_kraft FROM days WHERE entry_date = '2026-11-14'`).first()).gym_kraft, 0);
  // neuer Satz am selben Tag -> Training wieder gesetzt (nur hochsetzen)
  GYM.raw.prepare('INSERT INTO log (ts, person, uebung, gewicht, wdh) VALUES (?,?,?,?,?)').run('2026-11-14T10:30:00.000Z', 'Kratos', 'Chest Press', 50, 10);
  await importGym({ DB, GYM }, { now: NOW });
  assert.equal((await DB.prepare(`SELECT gym_kraft FROM days WHERE entry_date = '2026-11-14'`).first()).gym_kraft, 1);
  const g = await DB.prepare(`SELECT * FROM gym_days WHERE entry_date = '2026-11-14'`).first();
  assert.deepEqual([g.saetze, g.volumen, g.cardio_min], [3, 1000, 20]);
});

test('Backfill einmalig 60 Tage, danach nur die letzten Tage; ohne Binding/Tabellen still überspringen', async () => {
  const DB = createD1();
  await ensureSchema(DB);
  const GYM = gymDb([['2026-09-20T17:00:00.000Z', 'Kratos', 'Chest Press', 40, 10], ['2026-08-01T17:00:00.000Z', 'Kratos', 'Chest Press', 40, 10]]);
  const r1 = await importGym({ DB, GYM }, { now: NOW });
  assert.deepEqual(r1.changed, ['2026-09-20']); // 01.08. liegt vor den 60 Tagen
  assert.ok(await DB.prepare(`SELECT value FROM app_settings WHERE key = 'gym_backfill_done'`).first());
  await DB.prepare('DELETE FROM gym_days').run();
  assert.deepEqual((await importGym({ DB, GYM }, { now: NOW })).changed, []); // danach nur 3 Tage
  assert.equal((await importGym({ DB }, { now: NOW })).skipped, 'kein Binding');
  assert.equal((await importGym({ DB, GYM: createD1() }, { now: NOW })).skipped, 'keine Gym-Tabellen');
});
