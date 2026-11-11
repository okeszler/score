import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, alcoholUnits, challengeStats, drinkDecision, scoreAll, scoreDay, weekSummary } from '../public/assets/score.js';

const goals = { steps_target: 10000, kcal_target: 2000, protein_target: 140, water_target: 2000, weekly_beer_budget: 6 };
const CH = { start: '2026-11-11', check: '2026-12-16' };
// perfekter Tag (Bewegung 4, Ernährung 3) mit optional Alkohol
const day = (d, extra = {}) => ({ entry_date: d, created_at: 'x', confirmed: 1, beer_count: 0, shots_count: 0,
  steps: 12000, gym_kraft: 1, calories_kcal: 1800, protein_g: 150, water_ml: 2500, ...extra });

test('Stamperl zählt als 0,33 Bier', () => {
  assert.equal(alcoholUnits({ beer_count: 1, shots_count: 3 }), 1 + 3 * 0.33);
  assert.equal(scoreDay(day('d', { shots_count: 1 }), goals).parts.alkohol, 2);   // 0,33 Bier ≈ wie 1 Bier
  assert.equal(scoreDay(day('d', { shots_count: 4 }), goals).parts.alkohol, 1);   // 1,32 Bier
  assert.equal(scoreDay(day('d', { shots_count: 7 }), goals).parts.alkohol, 0);   // 2,31 Bier
});

test('Challenge: alkoholfrei +2 (max. 10), Alkohol-Tag höchstens Orange, Budget 0', () => {
  const free = scoreDay(day('d', { steps: 4000, gym_kraft: 0, calories_kcal: 2500, protein_g: 50, water_ml: 0 }), goals, 0, { challenge: true });
  assert.deepEqual([free.total, free.parts.bonus, free.status], [5, 2, 'orange']); // 0 + 0 + 3 + 2
  assert.equal(scoreDay(day('d'), goals, 0, { challenge: true }).total, 10);        // 4 + 3 + 3 + 2 → gedeckelt
  const one = scoreDay(day('d', { shots_count: 1 }), goals, 0, { challenge: true });
  assert.deepEqual([one.parts.alkohol, one.parts.bonus, one.total, one.status], [0, 0, 6, 'orange']); // Budget 0 → Alkohol 0; max. 6
  // ohne Challenge: 1 Bier bei Budget 6 → 9, grün
  assert.equal(scoreDay(day('d', { beer_count: 1 }), goals, 0).total, 9);
});

test('scoreAll/weekSummary: Challenge nur ab Start, Woche mit Challenge hat Budget 0', () => {
  const days = { '2026-11-09': day('2026-11-09', { beer_count: 1 }), '2026-11-11': day('2026-11-11'), '2026-11-12': day('2026-11-12', { shots_count: 2 }) };
  const sc = scoreAll(days, goals, CH);
  assert.equal(sc['2026-11-09'].challenge, false);
  assert.equal(sc['2026-11-09'].total, 9);
  assert.equal(sc['2026-11-11'].total, 10);
  assert.equal(sc['2026-11-12'].total, 6);
  const w = weekSummary(days, sc, goals, '2026-11-09', '2026-11-15', CH);
  assert.equal(w.beerBudget, 0);
  assert.equal(w.shots, 2);
  assert.equal(w.beerCount, 1);
  assert.equal(w.beers, 1.66);
});

test('challengeStats: Streak, Rückfall setzt auf 0, Gesamt bleibt, offener Tag unterbricht', () => {
  const days = {};
  for (let i = 0; i < 8; i++) days[addDays(CH.start, i)] = day(addDays(CH.start, i));
  let s = challengeStats(days, CH, '2026-11-18');
  assert.deepEqual([s.streak, s.free, s.best, s.milestone, s.badges], [8, 8, 8, null, [3, 7]]);
  assert.equal(s.daysToCheck, 28);
  // Rückfall am 19.: Streak 0, Gesamt bleibt 8
  days['2026-11-19'] = day('2026-11-19', { beer_count: 2 });
  s = challengeStats(days, CH, '2026-11-19');
  assert.deepEqual([s.streak, s.free, s.drinkDays, s.best, s.blockedBy], [0, 8, 1, 8, 'alcohol']);
  // heute (20.) noch offen -> Streak zählt bis gestern = 0; 21. alkoholfrei bestätigt
  days['2026-11-21'] = day('2026-11-21');
  s = challengeStats(days, CH, '2026-11-21');
  assert.deepEqual([s.streak, s.open, s.blockedBy], [1, 1, 'open']); // 20. offen unterbricht
  // nur Wasser getippt = nicht bestätigt
  days['2026-11-20'] = day('2026-11-20', { confirmed: 0, provisional: true });
  assert.equal(challengeStats(days, CH, '2026-11-21').streak, 1);
  days['2026-11-20'] = day('2026-11-20');
  assert.equal(challengeStats(days, CH, '2026-11-21').streak, 2);
});

test('drinkDecision: Streak-Verlust, Score danach, Stamperl', () => {
  const days = {};
  for (let i = 0; i < 5; i++) days[addDays(CH.start, i)] = day(addDays(CH.start, i));
  const today = addDays(CH.start, 5);
  const r = drinkDecision(days, goals, today, CH, 'shot');
  assert.equal(r.streak, 5);
  assert.equal(r.streakAfter, 0);
  assert.equal(r.challenge, true);
  assert.equal(r.budget, 0);
  assert.ok(r.scoreNext <= 6);
  assert.equal(r.kcal, 50);
});
