// Minimaler D1-Nachbau auf node:sqlite für Tests (prepare/bind/run/all/first/batch)
import { DatabaseSync } from 'node:sqlite';

export function createD1() {
  const db = new DatabaseSync(':memory:');
  const wrap = (sql, params = []) => ({
    bind: (...p) => wrap(sql, p),
    async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), rows_written: Number(r.changes) } }; },
    async all() { return { results: db.prepare(sql).all(...params).map(r => ({ ...r })) }; },
    async first() { const r = db.prepare(sql).get(...params); return r ? { ...r } : null; },
  });
  return {
    raw: db,
    prepare: sql => wrap(sql),
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}
