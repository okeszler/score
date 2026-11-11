import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { ensureSchema } from '../lib/db.js';
import { onRequestPatch, onRequestPut } from '../functions/api/days/[date].js';

const req = (method, body) => new Request('https://s.test/api/days/x', { method, body: JSON.stringify(body) });
const call = (fn, db, date, body) => fn({ env: { DB: db }, params: { date }, request: req('X', body) }).then(r => r.json());

test('Bestätigung: Wasser nein, Bier/Passt so/Speichern/Nachtragen ja', async () => {
  const db = createD1();
  await ensureSchema(db);
  assert.equal((await call(onRequestPatch, db, '2026-11-01', { water_delta: 250 })).day.confirmed, 0);
  assert.equal((await call(onRequestPatch, db, '2026-11-01', { beer_delta: 0 })).day.confirmed, 1);
  assert.equal((await call(onRequestPatch, db, '2026-11-02', { beer_delta: 1 })).day.confirmed, 1);
  assert.equal((await call(onRequestPut, db, '2026-11-03', { water_ml: 500 })).day.confirmed, 1);
  // offenen Tag nachtragen: Bier absolut, Training optional, Wasser bleibt erhalten
  await call(onRequestPatch, db, '2026-11-04', { water_delta: 750 });
  const d = (await call(onRequestPatch, db, '2026-11-04', { beer_count: 2, gym: true })).day;
  assert.deepEqual([d.beer_count, d.gym_kraft, d.water_ml, d.confirmed], [2, 1, 750, 1]);
  assert.equal((await call(onRequestPatch, db, '2026-11-04', { beer_count: -1 })).error, 'beer_count ungültig');
});

test('Migration: bestehende Zeilen nur mit Wasser werden unbestätigt', async () => {
  const db = createD1();
  db.raw.exec(`CREATE TABLE days (entry_date TEXT PRIMARY KEY, gym_kraft INTEGER NOT NULL DEFAULT 0, gym_kardio INTEGER NOT NULL DEFAULT 0,
    walk_km REAL, steps INTEGER, calories_tracked INTEGER NOT NULL DEFAULT 0, calories_kcal INTEGER, protein_g INTEGER, water_ml INTEGER,
    beer_count INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO days (entry_date, water_ml) VALUES ('a', 500);
    INSERT INTO days (entry_date) VALUES ('b');
    INSERT INTO days (entry_date, water_ml, beer_count) VALUES ('c', 500, 1);`);
  await ensureSchema(db);
  const rows = (await db.prepare('SELECT entry_date, confirmed FROM days ORDER BY entry_date').all()).results;
  assert.deepEqual(rows.map(r => r.confirmed), [0, 1, 1]);
});

test('Stamperl: PATCH +1, Nachtragen mit Stamperl, PUT speichert shots_count', async () => {
  const db = createD1();
  await ensureSchema(db);
  let d = (await call(onRequestPatch, db, '2026-11-12', { shots_delta: 1 })).day;
  assert.deepEqual([d.shots_count, d.beer_count, d.confirmed], [1, 0, 1]);
  d = (await call(onRequestPatch, db, '2026-11-13', { beer_count: 0, shots_count: 2 })).day;
  assert.deepEqual([d.shots_count, d.beer_count, d.confirmed], [2, 0, 1]);
  d = (await call(onRequestPut, db, '2026-11-14', { beer_count: 1, shots_count: 3 })).day;
  assert.deepEqual([d.shots_count, d.beer_count], [3, 1]);
  assert.equal((await call(onRequestPatch, db, '2026-11-14', { shots_delta: 9 })).error, 'shots_delta ungültig');
});

test('Verlangen: speichern und auslesen, nur bekannte Auslöser', async () => {
  const { onRequestPost, onRequestGet } = await import('../functions/api/cravings.js');
  const db = createD1();
  await ensureSchema(db);
  const post = body => onRequestPost({ env: { DB: db }, request: new Request('https://s/api/cravings', { method: 'POST', body: JSON.stringify(body) }) }).then(r => r.json());
  assert.ok((await post({ entry_date: '2026-11-12', started_at: '19:40', level: 4, triggers: ['stress', 'abend', 'hack'], completed: true })).id);
  assert.equal((await post({ entry_date: '2026-11-12', started_at: '7' })).error, 'Uhrzeit fehlt');
  const r = await (await onRequestGet({ env: { DB: db }, request: new Request('https://s/api/cravings?from=2026-11-01') })).json();
  assert.deepEqual(r.cravings.map(c => [c.level, c.triggers, c.completed]), [[4, ['stress', 'abend'], 1]]);
});
