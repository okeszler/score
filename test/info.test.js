import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './helpers/d1.js';
import { ensureSchema, seedInfo } from '../lib/db.js';
import { onRequestGet, onRequestPost } from '../functions/api/info.js';
import { addDays, scoreDay } from '../public/assets/score.js';

const SEED = JSON.parse(readFileSync(new URL('../content/info_tips.json', import.meta.url)));
const get = (db, date, streak = 0) => onRequestGet({ env: { DB: db }, request: new Request(`https://s/api/info?date=${date}&streak=${streak}`) }).then(r => r.json());
const post = (db, body) => onRequestPost({ env: { DB: db }, request: new Request('https://s/api/info', { method: 'POST', body: JSON.stringify(body) }) }).then(r => r.json());

test('Seed-Datei: Pflichtfelder, eindeutige IDs, Kategorien, Pflicht-Themen, keine erfundenen Quellen', () => {
  const ids = new Set();
  const CATS = ['folgen', 'abstinenz', 'training', 'motivation', 'verlangen', 'alternativen', 'soziales'];
  for (const t of SEED.tips) {
    assert.ok(!ids.has(t.id), `doppelte id ${t.id}`); ids.add(t.id);
    assert.ok(CATS.includes(t.kategorie), `Kategorie ${t.kategorie}`);
    assert.ok(t.titel && t.kurz, `Text fehlt bei ${t.id}`);
    const sentences = t.kurz.split(/(?<=[.!?“])\s+(?=[A-ZÄÖÜ„])/).length;
    assert.ok(sentences >= 2 && sentences <= 4, `${t.id}: ${sentences} Sätze`);
    assert.equal(t.quelle, null, `${t.id}: Quelle nur nach Prüfung eintragen`);
  }
  // Inhalte sollen ruhig und alltagsnah bleiben: keine Notrufnummern (Wunsch des Nutzers)
  assert.ok(!SEED.tips.some(t => /\b(1450|144)\b/.test(`${t.kurz} ${t.lang ?? ''}`)), 'Notrufnummern bitte nicht in Infos');
  // Pflicht-Themen vorhanden
  for (const re of [/Triglycerid/, /Metformin/, /Testosteron/, /HALT/, /Nein danke/, /0,5 %/, /GGT|Gamma-GT/]) {
    assert.ok(SEED.tips.some(t => re.test(`${t.titel} ${t.kurz} ${t.lang ?? ''}`)), `Thema fehlt: ${re}`);
  }
});

test('Info des Tages: Streak-Tag hat Vorrang, sonst rotierend ohne Wiederholung; bei jedem Öffnen dieselbe', async () => {
  const db = createD1();
  await ensureSchema(db);
  assert.equal((await db.prepare('SELECT count(*) n FROM info_tips WHERE aktiv = 1').first()).n, SEED.tips.length);
  assert.equal(await seedInfo(db), false); // gleiche Version: nichts zu tun
  // Streak 3 -> Eintrag mit streak_tag 3
  const d1 = await get(db, '2026-11-14', 3);
  assert.equal(d1.tip.streak_tag, 3);
  assert.equal((await get(db, '2026-11-14', 4)).tip.id, d1.tip.id); // erneut öffnen: dieselbe
  // ohne Streak-Treffer: rotierend, nie zweimal, Streak-Einträge nicht in der Rotation
  const seen = new Set();
  const rotating = SEED.tips.filter(t => t.streak_tag == null).length;
  for (let i = 0; i < rotating; i++) {
    const r = await get(db, addDays('2026-12-01', i), 0);
    assert.equal(r.tip.streak_tag, null);
    assert.ok(!seen.has(r.tip.id), `Wiederholung ${r.tip.id}`);
    seen.add(r.tip.id);
  }
  // danach wieder von vorn: die am längsten nicht gezeigte
  const again = await get(db, addDays('2026-12-01', rotating + 5), 0);
  assert.equal(again.tip.id, [...seen][0]);
});

test('Noch eine Info, Gelesen, Bonus +1 im Score (max. 10)', async () => {
  const db = createD1();
  await ensureSchema(db);
  const first = await get(db, '2026-11-20', 0);
  const more = await post(db, { date: '2026-11-20', action: 'next' });
  assert.equal(more.tip.id, first.tip.id);
  assert.equal(more.more.length, 1);
  assert.notEqual(more.more[0].id, first.tip.id);
  assert.equal(more.read, false);
  const r = await post(db, { date: '2026-11-20', action: 'read', tip_id: first.tip.id });
  assert.equal(r.read, true);
  assert.equal((await post(db, { date: '2026-11-20', action: 'read', tip_id: 999 })).error, 'Info wurde heute nicht gezeigt');
  const day = { entry_date: 'd', created_at: 'x', beer_count: 0, steps: 4000 };
  assert.equal(scoreDay({ ...day, info_read: true }, {}).total - scoreDay(day, {}).total, 1);
  assert.equal(scoreDay({ ...day, steps: 12000, gym_kraft: 1, calories_kcal: 1800, protein_g: 150, water_ml: 2500, info_read: true }, {}).total, 10);
});
