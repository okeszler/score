import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cron/worker.js';

test('Cron läuft nur um 23 Uhr Berliner Zeit', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(opts.headers.Authorization);
    return new Response(JSON.stringify({ imported: ['a'], skipped: 0, stepsDays: 3, weightReadings: 0, errors: [], remaining: 0 }));
  };
  const env = { SYNC_URL: 'https://x/api/sync', CRON_SECRET: 's' };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 6, 1, 21, 59) }, env); // Sommer: 23:59 Berlin
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 6, 1, 22, 59) }, env); // Sommer: 00:59 -> nichts
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 11, 1, 21, 59) }, env); // Winter: 22:59 -> nichts
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 11, 1, 22, 59) }, env); // Winter: 23:59 Berlin
  assert.deepEqual(calls, ['Bearer s', 'Bearer s']);
});
