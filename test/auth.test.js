import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { ensureSchema } from '../lib/db.js';
import { createSession, hmac, signingKey, verifySession } from '../lib/auth.js';
import { onRequestPost as login } from '../functions/api/login.js';

const env = db => ({ DB: db, APP_PASSWORD: '4711', SESSION_SECRET: 'x'.repeat(40) });
const post = (e, password) => login({ env: e, request: new Request('https://s.test/api/login', { method: 'POST', body: JSON.stringify({ password }) }) });
const withCookie = c => new Request('https://s.test/', { headers: { Cookie: c.split(';')[0] } });

test('Session: Schlüssel hängt am Secret, nicht nur an der PIN; Ablauf nach oben begrenzt', async () => {
  const e = env(null);
  const key = await signingKey(e);
  assert.notEqual(key, e.APP_PASSWORD);
  assert.notEqual(key, await signingKey({ ...e, APP_PASSWORD: '4712' })); // PIN-Wechsel macht Sessions ungültig
  assert.equal(await verifySession(withCookie(await createSession(key)), key), true);
  // mit der PIN allein signiertes Cookie (alte Schwachstelle) wird abgelehnt
  const exp = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(await verifySession(withCookie(`score_session=${exp}.${await hmac('4711', `score:${exp}`)}`), key), false);
  // selbst mit richtigem Schlüssel: kein Ablauf weit in der Zukunft
  const far = Math.floor(Date.now() / 1000) + 400 * 86400;
  assert.equal(await verifySession(withCookie(`score_session=${far}.${await hmac(key, `score:${far}`)}`), key), false);
  await assert.rejects(signingKey({ APP_PASSWORD: '1' }), /SESSION_SECRET/);
});

test('PIN-Anmeldung: Sperre nach 5 Fehlversuchen, auch bei parallelen Anfragen', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = createD1();
  await ensureSchema(db);
  const e = env(db);
  const tick = setInterval(() => {}, 1); // hält den Event-Loop
  const run = async pin => { const p = post(e, pin); for (let i = 0; i < 20; i++) { await Promise.resolve(); t.mock.timers.tick(1000); await new Promise(r => setImmediate(r)); } return (await p).status; };
  // 12 parallele falsche Versuche: höchstens 5 werden überhaupt geprüft (401), der Rest ist gesperrt (429)
  const many = Array.from({ length: 12 }, (_, i) => post(e, `000${i}`));
  for (let i = 0; i < 30; i++) { t.mock.timers.tick(1000); await new Promise(r => setImmediate(r)); }
  const codes = (await Promise.all(many)).map(r => r.status);
  assert.equal(codes.filter(c => c === 401).length, 5);
  assert.equal(codes.filter(c => c === 429).length, 7);
  // während der Sperre hilft auch die richtige PIN nicht
  assert.equal(await run('4711'), 429);
  // Sperre abgelaufen -> richtige PIN meldet an und setzt den Zähler zurück
  await db.prepare(`UPDATE auth_state SET locked_until = 1`).run();
  assert.equal(await run('4711'), 200);
  assert.deepEqual({ ...(await db.prepare(`SELECT fails, locked_until FROM auth_state`).first()) }, { fails: 0, locked_until: 0 });
  // nach Ablauf einer Sperre: ein Fehlversuch -> sofort längere Sperre
  await db.prepare(`UPDATE auth_state SET fails = 6, locked_until = 1`).run();
  assert.equal(await run('9999'), 401);
  const st = await db.prepare(`SELECT fails, locked_until FROM auth_state`).first();
  assert.equal(st.fails, 7);
  assert.ok(st.locked_until - Date.now() / 1000 > 200);
  clearInterval(tick);
});
