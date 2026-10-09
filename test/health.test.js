import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpCategory, dailyPulse, groupNights, restingHeartRate } from '../public/assets/health.js';

test('Blutdruck-Einstufung ESC/ESH: höhere Kategorie zählt', () => {
  assert.equal(bpCategory(118, 78).label, 'Optimal');
  assert.equal(bpCategory(122, 85).label, 'Hoch-normal'); // diastolisch 85 -> hoch-normal
  assert.equal(bpCategory(131, 82).label, 'Hoch-normal');
  assert.equal(bpCategory(145, 70).label, 'Hypertonie Grad 1');
  assert.equal(bpCategory(185, 90).label, 'Hypertonie Grad 3');
  assert.equal(bpCategory(null, 80), null);
});

test('Schlaf über Mitternacht = eine Nacht am Aufwach-Tag; Nickerchen getrennt', () => {
  const seg = (ts, s, stage) => ({ start_ts: ts, seconds: s, stage });
  const nights = groupNights([
    seg('2026-10-08 23:00:00', 3600, 'light'), seg('2026-10-09 00:00:00', 7200, 'deep'),
    seg('2026-10-09 02:00:00', 600, 'awake'), seg('2026-10-09 02:10:00', 14400, 'rem'),
    seg('2026-10-09 14:00:00', 1800, 'light'), // Nickerchen
  ]);
  assert.equal(nights.length, 2);
  const [n, nap] = nights;
  assert.equal(n.date, '2026-10-09');
  assert.equal(n.isNight, true);
  assert.equal(n.asleepSeconds, 3600 + 7200 + 14400);
  assert.equal(n.awakeSeconds, 600);
  assert.equal(nap.isNight, false);
});

test('Ruhepuls aus Stundenwerten der Nacht, Tagesschnitt gewichtet', () => {
  const nights = groupNights([{ start_ts: '2026-10-08 23:00:00', seconds: 8 * 3600, stage: 'light' }]);
  const hourly = [
    { entry_date: '2026-10-08', hour: 23, n: 6, avg_bpm: 58, min_bpm: 55, max_bpm: 62 },
    { entry_date: '2026-10-09', hour: 2, n: 6, avg_bpm: 54, min_bpm: 50, max_bpm: 57 },
    { entry_date: '2026-10-09', hour: 12, n: 6, avg_bpm: 90, min_bpm: 80, max_bpm: 110 }, // Tag, zählt nicht
  ];
  assert.deepEqual(restingHeartRate(nights, hourly), { '2026-10-09': 56 });
  const day = dailyPulse(hourly).find(d => d.date === '2026-10-09');
  assert.deepEqual([day.avg, day.min, day.max], [72, 50, 110]);
});
