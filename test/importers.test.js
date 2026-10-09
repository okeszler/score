import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { ensureSchema } from '../lib/db.js';
import { importStatement } from '../lib/importers.js';

async function setup() {
  const db = createD1();
  // Altes Score-Schema hat sync_steps_readings nicht zwingend – ensureSchema muss trotzdem laufen
  await ensureSchema(db);
  return db;
}
const run = async (db, category, text, name = 'x.csv', modifiedTime = '2026-10-09T08:00:00Z') => {
  const report = { stepsDays: 0, weightReadings: 0, nutritionDays: 0, pulseHours: 0, sleepSegments: 0, bloodPressure: 0, activities: 0 };
  const st = importStatement(db, { category, name, modifiedTime }, text, report);
  const r = st ? await st.run() : { meta: { changes: 0 } };
  return { written: r.meta.changes, report };
};

test('Puls: Stundenwerte, erneuter Import schreibt nichts, vollständigerer Export gewinnt', async () => {
  const db = await setup();
  const csv = 'Datum,Zeit,Puls,Datenquelle\n2026.10.09 08:10:29,08:10:29,66,x\n2026.10.09 08:20:29,08:20:29,70,x\n2026.10.09 09:00:47,09:00:47,59,x\n';
  assert.equal((await run(db, 'puls', csv)).written, 2);
  assert.equal((await run(db, 'puls', csv)).written, 0);
  const more = csv + '2026.10.09 08:30:29,08:30:29,80,x\n';
  assert.equal((await run(db, 'puls', more)).written, 1);
  const h8 = await db.prepare('SELECT * FROM sync_pulse_hourly WHERE hour = 8').first();
  assert.deepEqual([h8.n, h8.avg_bpm, h8.min_bpm, h8.max_bpm], [3, 72, 66, 80]);
});

test('Schlaf: Segmente idempotent', async () => {
  const db = await setup();
  const csv = 'Datum,Zeit,Durée en secondes,Schlafstadium\n2026.10.03 13:14:00,13:14:00,960,light\n2026.10.03 13:30:00,13:30:00,120,awake\n';
  assert.equal((await run(db, 'schlaf', csv)).written, 2);
  assert.equal((await run(db, 'schlaf', csv)).written, 0);
});

test('Blutdruck (Samsung Health) und Aktivität', async () => {
  const db = await setup();
  const bp = 'Datum,Zeit,Diastolisch,Systolisch,Puls,Kommentar\n2026.07.24 08:37:46,08:37:46,85.0,131.0,0,\n2026.07.30 15:17:18,15:17:18,82.0,130.0,62,\n';
  assert.equal((await run(db, 'blutdruck', bp)).written, 2);
  assert.equal((await run(db, 'blutdruck', bp)).written, 0);
  const r = await db.prepare("SELECT * FROM blood_pressure WHERE entry_date = '2026-07-24'").first();
  assert.deepEqual([r.systolic, r.diastolic, r.pulse, r.source], [131, 85, null, 'sync']);
  const act = 'Quell-App,Aktivitätstyp,Aktivitätsname,Datum,Zeit,Verstrichene Zeit,Aktive Zeit,Entfernung (km),Kalorien (kcal),Schritte,Durchschnittliche Herzfrequenz,Maximale Herzfrequenz,Durchschnittsgeschwindigkeit\n'
    + 'Health Sync,WALKING,null,2026.10.07 16:22:17,16:22:17,667,667,0.3293775,24.441164,726,90,113,5.5\n';
  assert.equal((await run(db, 'aktivitaeten', act)).written, 1);
  assert.equal((await run(db, 'aktivitaeten', act)).written, 0);
  const a = await db.prepare('SELECT * FROM sync_activities').first();
  assert.deepEqual([a.activity_type, a.elapsed_seconds, a.steps, a.avg_hr], ['WALKING', 667, 726, 90]);
});

test('Schritte, Gewicht, Ernährung: unveränderte Zeilen kosten keine Schreibvorgänge', async () => {
  const db = await setup();
  const steps = 'Datum,Zeit,Schritte\n2026.10.07 06:00:00,06:00:00,16\n2026.10.07 06:01:00,06:01:00,7\n';
  assert.equal((await run(db, 'schritte', steps)).written, 1);
  assert.equal((await run(db, 'schritte', steps)).written, 0);
  const w = 'Datum,Zeit,Gewicht,Körperfettanteil,Gesamtkörperwasser,Grundumsatz\n2026.10.09 08:23:41,08:23:41,"94.9","22.8","53.78","1952"\n';
  assert.equal((await run(db, 'gewicht', w)).written, 1);
  assert.equal((await run(db, 'gewicht', w)).written, 0);
  const n = 'Datum,Zeit,Mahlzeit,Name,Beschreibung,kcal,Protein (g)\n2026.10.08 10:00:00,10:00:00,1,null,null,510.7,84.88\n';
  assert.equal((await run(db, 'ernaehrung', n)).written, 1);
  assert.equal((await run(db, 'ernaehrung', n, 'x', '2026-10-09T09:00:00Z')).written, 0);
});

test('Ernährung: neuerer Export ohne Protein, älterer Tagesexport füllt Protein nach', async () => {
  const db = await setup();
  const head = 'Datum,Zeit,Mahlzeit,Name,Beschreibung,kcal,Kohlenhydrate (Gramm),Zucker (Gramm)';
  const range = `${head}\n2026.10.08 10:00:00,10:00:00,1,null,null,510.7,31.42,28.36\n`;
  const daily = `${head},Protein (g)\n2026.10.08 10:00:00,10:00:00,1,null,null,510.7,31.42,28.36,84.88\n`;
  assert.equal((await run(db, 'ernaehrung', range, 'r.csv', '2026-10-09T08:54:37Z')).written, 1);
  assert.equal((await run(db, 'ernaehrung', daily, 'd.csv', '2026-10-09T08:54:29Z')).written, 1);
  let r = await db.prepare('SELECT * FROM sync_nutrition_daily').first();
  assert.deepEqual([r.kcal, r.protein_g, r.src_time], [511, 85, '2026-10-09T08:54:37Z']);
  // erneut: keine Schreibvorgänge; älterer Export mit anderen kcal überschreibt nicht
  assert.equal((await run(db, 'ernaehrung', range, 'r.csv', '2026-10-09T08:54:37Z')).written, 0);
  assert.equal((await run(db, 'ernaehrung', daily.replace('510.7', '400'), 'd.csv', '2026-10-09T08:00:00Z')).written, 0);
  // neuerer Export mit Protein gewinnt
  assert.equal((await run(db, 'ernaehrung', daily.replace('84.88', '90'), 'n.csv', '2026-10-09T20:00:00Z')).written, 1);
  r = await db.prepare('SELECT * FROM sync_nutrition_daily').first();
  assert.equal(r.protein_g, 90);
});
