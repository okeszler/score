import { json, readJson, handler, HttpError } from '../../lib/http.js';
import { assertDate } from '../../lib/validate.js';

// GET  /api/info?date=YYYY-MM-DD&streak=N  -> Info des Tages (bei jedem Öffnen dieselbe) + weitere heute gezeigte
// POST /api/info { date, action: 'next' }          -> eine weitere Info aus der Bibliothek
// POST /api/info { date, action: 'read', tip_id }  -> als gelesen abhaken (+1 Bonuspunkt pro Tag im Score)

const shownToday = (db, date) => db.prepare(`SELECT t.*, r.gelesen FROM info_reads r JOIN info_tips t ON t.id = r.tip_id
  WHERE r.entry_date = ? ORDER BY r.rowid`).bind(date).all().then(r => r.results);

/**
 * Nächste Info: zuerst noch nie gezeigte (in Reihenfolge der Seed-Datei), danach die am längsten nicht gezeigte –
 * so wiederholt sich nichts, bis alle durch sind. Einträge mit Streak-Tag kommen nur an ihrem Tag.
 */
const nextTip = (db, date) => db.prepare(`SELECT t.* FROM info_tips t
  LEFT JOIN (SELECT tip_id, MAX(entry_date) AS last FROM info_reads GROUP BY tip_id) s ON s.tip_id = t.id
  WHERE t.aktiv = 1 AND t.streak_tag IS NULL AND t.id NOT IN (SELECT tip_id FROM info_reads WHERE entry_date = ?)
  ORDER BY s.last IS NOT NULL, s.last, t.id LIMIT 1`).bind(date).first();

const remember = (db, date, id) => db.prepare(`INSERT OR IGNORE INTO info_reads (entry_date, tip_id) VALUES (?, ?)`).bind(date, id).run();

async function summary(db, date) {
  const tips = await shownToday(db, date);
  const counts = await db.prepare(`SELECT (SELECT count(*) FROM info_tips WHERE aktiv = 1) AS total,
    (SELECT count(DISTINCT tip_id) FROM info_reads WHERE gelesen = 1) AS read`).first();
  return { tip: tips[0] || null, more: tips.slice(1), read: tips.some(t => t.gelesen), total: counts.total, readTotal: counts.read };
}

export const onRequestGet = handler(async ({ request, env }) => {
  const p = new URL(request.url).searchParams;
  const date = assertDate(p.get('date'));
  const streak = Number(p.get('streak'));
  const existing = await shownToday(env.DB, date);
  if (!existing.length) {
    const byStreak = Number.isInteger(streak) && streak > 0
      ? await env.DB.prepare(`SELECT * FROM info_tips WHERE aktiv = 1 AND streak_tag = ? ORDER BY id LIMIT 1`).bind(streak).first()
      : null;
    const tip = byStreak || (await nextTip(env.DB, date));
    if (tip) await remember(env.DB, date, tip.id);
  }
  return json(await summary(env.DB, date));
});

export const onRequestPost = handler(async ({ request, env }) => {
  const b = await readJson(request);
  const date = assertDate(b.date);
  if (b.action === 'next') {
    const tip = await nextTip(env.DB, date);
    if (!tip) throw new HttpError('Heute schon alle Infos gezeigt', 404);
    await remember(env.DB, date, tip.id);
  } else if (b.action === 'read') {
    const r = await env.DB.prepare(`UPDATE info_reads SET gelesen = 1 WHERE entry_date = ? AND tip_id = ?`).bind(date, Number(b.tip_id)).run();
    if (!r.meta.changes) throw new HttpError('Info wurde heute nicht gezeigt', 404);
  } else throw new HttpError('Unbekannte Aktion');
  return json(await summary(env.DB, date));
});
