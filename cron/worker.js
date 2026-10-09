// Automatischer Health Sync für Olivers Score: alle 30 Minuten (:29 und :59),
// tagsüber von 06:29 bis 23:59 Berliner Zeit; nachts (00:29–05:59) Pause.
// Cloudflare-Cron läuft in UTC – die Zeitzone (Sommer/Winter) prüft der Worker selbst.
export const FIRST_HOUR = 6; // erster Lauf 06:29

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
    if (!env.FORCE_RUN && berlinHour(new Date(event.scheduledTime)) < FIRST_HOUR) return;
    let result;
    try {
      result = await runSync(env);
    } catch (e) {
      // Fehler, die die App selbst nicht protokollieren konnte (Netzwerk, Antwortformat …)
      await env.DB?.prepare("INSERT INTO sync_log (source, errors) VALUES ('cron', ?)").bind(JSON.stringify([`Worker: ${e.message}`])).run();
      throw e;
    }
    console.log('Health Sync', JSON.stringify(result));
    if (result.errors.length) throw new Error(`Sync mit Fehlern: ${result.errors.join('; ')}`);
  },
};
