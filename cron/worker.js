// Nächtlicher Health Sync für Olivers Score.
// Cloudflare-Cron läuft in UTC; der Trigger feuert um 21:59 und 22:59 UTC,
// ausgeführt wird nur der, der in Berlin 23:59 entspricht (Sommer-/Winterzeit).

function berlinHour(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find(p => p.type === 'hour').value);
}

async function runSync(env) {
  const total = { imported: 0, skipped: 0, stepsDays: 0, weightReadings: 0, errors: [] };
  for (let round = 0; round < 10; round++) {
    const res = await fetch(env.SYNC_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
    if (!res.ok) throw new Error(`Sync HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const r = await res.json();
    total.imported += r.imported.length;
    total.skipped += r.skipped;
    total.stepsDays += r.stepsDays;
    total.weightReadings += r.weightReadings;
    total.errors.push(...r.errors);
    if (!r.remaining || (r.imported.length === 0 && r.skipped === 0)) break;
  }
  return total;
}

export default {
  async scheduled(event, env) {
    if (berlinHour(new Date(event.scheduledTime)) !== 23) return;
    const result = await runSync(env);
    console.log('Health Sync', JSON.stringify(result));
    if (result.errors.length) throw new Error(`Sync mit Fehlern: ${result.errors.join('; ')}`);
  },
};
