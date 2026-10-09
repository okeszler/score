import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreDay, scoreAll, weekSummary, activeStreak, weekStreak, weightTrend, beerDecision,
  weekStart, addDays, isValidDate, effectiveSteps, mergeGoals,
} from '../public/assets/score.js';

const goals = mergeGoals({});
const day = (date, o = {}) => ({ entry_date: date, created_at: 'x', beer_count: 0, gym_kraft: 0, gym_kardio: 0, ...o });

test('Datum-Helfer', () => {
  assert.equal(weekStart('2026-10-07'), '2026-10-05'); // Mi -> Mo
  assert.equal(weekStart('2026-10-11'), '2026-10-05'); // So -> Mo
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // über Sommerzeit
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('07.10.2026'));
});

test('Kein Eintrag ist "none", nicht rot', () => {
  assert.equal(scoreDay(undefined, goals).status, 'none');
  assert.equal(scoreDay({ entry_date: '2026-01-01' }, goals).status, 'none');
});

test('Perfekter Tag = 10', () => {
  const s = scoreDay(day('2026-10-05', { steps: 12000, gym_kraft: 1, calories_kcal: 1800, protein_g: 150, water_ml: 2000 }), goals);
  assert.equal(s.total, 10);
  assert.equal(s.status, 'green');
});

test('Ernährung: kcal im Ziel, Protein, Wasser – je 1 Punkt', () => {
  const s = scoreDay(day('2026-09-11', { steps: 6000, calories_tracked: 0, calories_kcal: 1900, protein_g: 100 }), goals);
  assert.deepEqual(s.parts, { bewegung: 1, ernaehrung: 1, alkohol: 3 });
  assert.equal(scoreDay(day('d', { water_ml: 1999 }), goals).parts.ernaehrung, 0);
  assert.equal(scoreDay(day('d', { water_ml: 2000 }), goals).parts.ernaehrung, 1);
  assert.equal(scoreDay(day('d', { water_ml: 1500 }), { water_target: 1500 }).parts.ernaehrung, 1);
});

test('MyFitnessPal-Import als Fallback, manuelle Werte haben Vorrang', () => {
  assert.equal(scoreDay(day('d', { synced_kcal: 1800, synced_protein: 150 }), goals).parts.ernaehrung, 2);
  assert.equal(scoreDay(day('d', { calories_kcal: 2500, synced_kcal: 1800 }), goals).parts.ernaehrung, 0);
  assert.equal(scoreDay(day('d', { protein_g: 90, synced_protein: 150 }), goals).parts.ernaehrung, 0);
});

test('Wochenbudget überschritten -> Alkohol 0', () => {
  assert.equal(scoreDay(day('d', { beer_count: 1 }), goals, 5).parts.alkohol, 2);
  assert.equal(scoreDay(day('d', { beer_count: 1 }), goals, 6).parts.alkohol, 0);
  assert.equal(scoreDay(day('d', { beer_count: 0 }), goals, 9).parts.alkohol, 3);
});

test('Effektive Schritte: manuell > Sync > Walk', () => {
  assert.equal(effectiveSteps({ steps: 5000, synced_steps: 9000 }), 5000);
  assert.equal(effectiveSteps({ steps: null, synced_steps: 9000 }), 9000);
  assert.equal(effectiveSteps({ steps: null, synced_steps: null, walk_km: 2 }), 2600);
});

test('scoreAll berücksichtigt laufendes Wochenbudget', () => {
  const days = {};
  for (let i = 0; i < 4; i++) days[addDays('2026-10-05', i)] = day(addDays('2026-10-05', i), { beer_count: 2 });
  const s = scoreAll(days, goals);
  assert.equal(s['2026-10-05'].parts.alkohol, 1);
  assert.equal(s['2026-10-07'].parts.alkohol, 1); // 4+2 = 6, noch im Budget
  assert.equal(s['2026-10-08'].parts.alkohol, 0); // 8 > 6
});

test('Wochenzusammenfassung und Streaks', () => {
  const days = {};
  const green = d => day(d, { steps: 11000, calories_kcal: 1800, protein_g: 150, water_ml: 2500 });
  for (let i = 0; i < 7; i++) days[addDays('2026-09-28', i)] = green(addDays('2026-09-28', i));
  for (let i = 0; i < 3; i++) days[addDays('2026-10-05', i)] = green(addDays('2026-10-05', i));
  const scores = scoreAll(days, goals);
  const w = weekSummary(days, scores, goals, '2026-09-28', '2026-10-07');
  assert.equal(w.green, 7);
  assert.ok(w.reached);
  assert.equal(activeStreak(scores, '2026-10-07'), 10);
  assert.equal(activeStreak(scores, '2026-10-08'), 10); // heute noch leer -> ab gestern
  assert.equal(weekStreak(days, scores, goals, '2026-10-07'), 1);
});

test('Gewichtstrend & Prognose', () => {
  const ws = [0, 7, 14, 21, 28].map((d, i) => ({ entry_date: addDays('2026-09-09', d), weight_kg: 94 - i * 0.5 }));
  const t = weightTrend(ws, 85, '2026-10-07');
  assert.ok(Math.abs(t.perWeek + 0.5) < 1e-9);
  assert.ok(t.eta > '2027-01-01' && t.eta < '2027-04-01');
  assert.equal(weightTrend(ws.slice(0, 1), 85, '2026-10-07'), null);
});

test('Bier-Entscheidung', () => {
  const days = { '2026-10-05': day('2026-10-05', { beer_count: 5 }) };
  const r = beerDecision(days, goals, '2026-10-07');
  assert.equal(r.weekAfter, 6);
  assert.equal(r.verdict, 'ok'); // 6. Bier: noch im Budget, kein Risikotag
  const meh = beerDecision({ '2026-10-07': day('2026-10-07', { beer_count: 1 }) }, goals, '2026-10-07');
  assert.equal(meh.verdict, 'meh'); // 2. Bier heute = Risikotag, aber im Budget
  const r2 = beerDecision({ ...days, '2026-10-07': day('2026-10-07', { beer_count: 1 }) }, goals, '2026-10-07');
  assert.equal(r2.verdict, 'no');
});

test('Vorläufige Tage aus importierten Daten: 0 Bier angenommen, zählen nicht als alkoholfrei', async () => {
  const { withProvisionalDays, isConfirmed, hasEntry } = await import('../public/assets/score.js');
  const confirmed = { '2026-10-05': day('2026-10-05', { beer_count: 2, steps: 9000 }) };
  const all = withProvisionalDays(confirmed, { '2026-10-06': 12000, '2026-10-20': 5000 }, { '2026-10-06': { kcal: 1800, protein: 150 } }, '2026-10-07');
  assert.ok(all['2026-10-06'].provisional);
  assert.ok(all['2026-10-07'].provisional, 'heute bekommt immer einen Tag');
  assert.equal(all['2026-10-20'], undefined, 'keine Tage in der Zukunft');
  assert.ok(hasEntry(all['2026-10-06']) && !isConfirmed(all['2026-10-06']));
  assert.ok(isConfirmed(all['2026-10-05']));
  const scores = scoreAll(all, goals);
  assert.equal(scores['2026-10-06'].total, 3 + 2 + 3); // Schritte 3, kcal+Protein 2, Alkohol 3 (angenommen)
  assert.equal(scores['2026-10-06'].provisional, true);
  const w = weekSummary(all, scores, goals, '2026-10-05', '2026-10-07');
  assert.equal(w.provisional, 2);
  assert.equal(w.alcoholFree, 0);
});
