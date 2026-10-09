// Gesundheits-Logik (Browser UND Server): Blutdruck-Einstufung, Schlafnächte, Ruhepuls.

/** Blutdruck-Einstufung nach ESC/ESH (Praxismessung). Die höhere Kategorie von sys/dia zählt. */
export const BP_LEVELS = [
  { max: [120, 80], label: 'Optimal', status: 'green' },
  { max: [130, 85], label: 'Normal', status: 'green' },
  { max: [140, 90], label: 'Hoch-normal', status: 'orange' },
  { max: [160, 100], label: 'Hypertonie Grad 1', status: 'red' },
  { max: [180, 110], label: 'Hypertonie Grad 2', status: 'red' },
  { max: [Infinity, Infinity], label: 'Hypertonie Grad 3', status: 'red' },
];

export function bpCategory(sys, dia) {
  if (sys == null || dia == null) return null;
  const idx = (v, i) => BP_LEVELS.findIndex(l => v < l.max[i]);
  return BP_LEVELS[Math.max(idx(sys, 0), idx(dia, 1))];
}

const SLEEP_GAP_MS = 4 * 3600 * 1000; // > 4 h Pause = neue Nacht
const NIGHT_MIN_MS = 3 * 3600 * 1000; // kürzere Blöcke sind Nickerchen

const toMs = ts => new Date(ts.replace(' ', 'T')).getTime();
const pad = n => String(n).padStart(2, '0');
const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * Schlafsegmente (lokale Zeitstempel "YYYY-MM-DD HH:MM:SS") zu Nächten gruppieren.
 * Eine Nacht gehört zum Aufwach-Tag.
 */
export function groupNights(segments) {
  const segs = segments
    .map(s => { const start = toMs(s.start_ts); return { start, end: start + s.seconds * 1000, stage: s.stage || 'unbekannt' }; })
    .filter(s => Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start);
  const nights = [];
  let cur = null;
  for (const s of segs) {
    if (!cur || s.start - cur.wake > SLEEP_GAP_MS) {
      cur = { bed: s.start, wake: s.end, stages: {}, segments: [] };
      nights.push(cur);
    }
    cur.wake = Math.max(cur.wake, s.end);
    cur.stages[s.stage] = (cur.stages[s.stage] || 0) + (s.end - s.start) / 1000;
    cur.segments.push(s);
  }
  return nights.map(n => {
    const awake = n.stages.awake || 0;
    const inBed = (n.wake - n.bed) / 1000;
    const asleep = Object.entries(n.stages).filter(([k]) => k !== 'awake').reduce((a, [, v]) => a + v, 0);
    return {
      date: localDate(n.wake), bed: n.bed, wake: n.wake, inBedSeconds: Math.round(inBed),
      asleepSeconds: Math.round(asleep), awakeSeconds: Math.round(awake),
      stages: Object.fromEntries(Object.entries(n.stages).map(([k, v]) => [k, Math.round(v)])),
      isNight: n.wake - n.bed >= NIGHT_MIN_MS,
      segments: n.segments.map(s => ({ start: s.start, end: s.end, stage: s.stage })),
    };
  });
}

/**
 * Ruhepuls je Aufwach-Tag: gewichteter Schnitt der Stundenwerte während der Hauptnacht.
 * hourly: [{ entry_date, hour, n, avg_bpm }]
 */
export function restingHeartRate(nights, hourly) {
  const byDate = {};
  const index = new Map(hourly.map(h => [`${h.entry_date}|${h.hour}`, h]));
  for (const n of nights.filter(x => x.isNight)) {
    let sum = 0, cnt = 0;
    // jede volle Stunde, die zu mind. der Hälfte in der Nacht liegt
    for (let t = n.bed - (n.bed % 3600000); t < n.wake; t += 3600000) {
      const overlap = Math.min(t + 3600000, n.wake) - Math.max(t, n.bed);
      if (overlap < 1800000) continue;
      const d = new Date(t);
      const h = index.get(`${localDate(t)}|${d.getHours()}`);
      if (h) { sum += h.avg_bpm * h.n; cnt += h.n; }
    }
    if (cnt) byDate[n.date] = Math.round((sum / cnt) * 10) / 10;
  }
  return byDate;
}

/** Tageswerte Puls aus Stundenwerten */
export function dailyPulse(hourly) {
  const out = {};
  for (const h of hourly) {
    const d = (out[h.entry_date] ||= { date: h.entry_date, n: 0, sum: 0, min: Infinity, max: -Infinity });
    d.n += h.n; d.sum += h.avg_bpm * h.n; d.min = Math.min(d.min, h.min_bpm); d.max = Math.max(d.max, h.max_bpm);
  }
  return Object.values(out).map(d => ({ date: d.date, avg: Math.round((d.sum / d.n) * 10) / 10, min: d.min, max: d.max }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const STAGE_LABELS = { deep: 'Tiefschlaf', rem: 'REM', light: 'Leichtschlaf', awake: 'Wach', sleeping: 'Schlaf', unbekannt: 'Schlaf' };
