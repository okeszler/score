import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cron/worker.js';

test('Cron: tagsüber alle 30 Min., nachts Pause (Berliner Zeit, Sommer/Winter)', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(opts.headers.Authorization);
    return new Response(JSON.stringify({ imported: ['a'], skipped: 0, stepsDays: 3, weightReadings: 0, errors: [], remaining: 0 }));
  };
  const env = { SYNC_URL: 'https://x/api/sync', CRON_SECRET: 's' };
  const at = (m, d, h, min) => worker.scheduled({ scheduledTime: Date.UTC(2026, m, d, h, min) }, env);
  await at(6, 1, 21, 59); // Sommer: 23:59 Berlin -> läuft
  await at(6, 1, 2, 29);  // Sommer: 04:29 Berlin -> Pause
  await at(6, 1, 4, 29);  // Sommer: 06:29 Berlin -> läuft
  await at(11, 1, 4, 59); // Winter: 05:59 Berlin -> Pause
  await at(11, 1, 5, 29); // Winter: 06:29 Berlin -> läuft
  await at(11, 1, 22, 59); // Winter: 23:59 Berlin -> läuft
  await at(11, 1, 23, 29); // Winter: 00:29 Berlin -> Pause
  assert.equal(calls.length, 4);
});
