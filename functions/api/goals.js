import { getGoals } from '../../lib/db.js';
import { json, readJson, handler, HttpError } from '../../lib/http.js';
import { GOAL_LIMITS, num } from '../../lib/validate.js';

export const onRequestGet = handler(async ({ env }) => json({ goals: await getGoals(env.DB) }));

export const onRequestPut = handler(async ({ request, env }) => {
  const body = await readJson(request);
  const stmts = [];
  for (const [key, [min, max]] of Object.entries(GOAL_LIMITS)) {
    if (!(key in body)) continue;
    const v = num(body[key], key, min, max);
    stmts.push(v == null
      ? env.DB.prepare('DELETE FROM goals WHERE key = ?').bind(key)
      : env.DB.prepare('INSERT INTO goals (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, v));
  }
  if (!stmts.length) throw new HttpError('Keine Ziele übergeben');
  await env.DB.batch(stmts);
  return json({ goals: await getGoals(env.DB) });
});
