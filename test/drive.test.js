import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStepsCsv, parseWeightCsv, rangeFromName } from '../lib/drive.js';

test('Schritte-CSV (Health Connect, deutsch)', () => {
  const csv = 'Datum,Zeit,Schritte\n2026.10.07 06:00:00,06:00:00,16\n2026.10.07 06:01:00,06:01:00,7\n2026.10.08 00:01:00,00:01:00,5\n';
  assert.deepEqual(parseStepsCsv(csv), { '2026-10-07': 23, '2026-10-08': 5 });
});

test('Gewicht-CSV mit Körperfett und gequoteten Werten', () => {
  const csv = 'Datum,Zeit,Gewicht,Körperfettanteil,Körperfettmasse\n'
    + '2026.08.08 16:52:14,16:52:14,"94.0","0.0","0.0"\n'
    + '2026.08.08 17:02:05,17:02:05,"94.0","25.344297","0.0"\n';
  const r = parseWeightCsv(csv);
  assert.equal(r.length, 2);
  assert.equal(r[0].body_fat_pct, null);
  assert.equal(r[1].body_fat_pct, 25.344297);
  assert.equal(r[1].entry_date, '2026-08-08');
});

test('Zeitraum aus Dateinamen', () => {
  assert.deepEqual(rangeFromName('Schritte 2026.09.06-2026.10.06 Health Connect.csv'), { from: '2026-09-06', to: '2026-10-06' });
  assert.deepEqual(rangeFromName('Schritte 2026.10.07 Health Connect.csv'), { from: '2026-10-07', to: '2026-10-07' });
  assert.equal(rangeFromName('Gewicht 32-2026 Health Connect.csv'), null);
});

test('Unbekanntes Format wirft', () => {
  assert.throws(() => parseStepsCsv('foo,bar\n1,2'));
});

test('Formatfehler sind als FormatError erkennbar', async () => {
  const { FormatError } = await import('../lib/drive.js');
  assert.throws(() => parseWeightCsv('a,b\n1,2'), FormatError);
});

test('Ernährungs-CSV (MyFitnessPal über Health Sync): Tagessummen', async () => {
  const { parseNutritionCsv } = await import('../lib/drive.js');
  const csv = 'Datum,Zeit,Mahlzeit,Name,Beschreibung,kcal,Kohlenhydrate (Gramm),Cholesterin (mg),Fett (Gramm),Ballaststoffe (Gramm),Zucker (Gramm),Protein (g),Vitamin A (mcg)\n'
    + '2026.10.08 10:00:00,10:00:00,1,null,null,510.7,31.42,0.0,3.26,0.0,28.36,84.88,0.0\n'
    + '2026.10.08 13:00:00,13:00:00,2,null,null,700.2,50,0,20,0,5,40.3,0\n'
    + '2026.10.09 08:00:00,08:00:00,1,null,null,300,10,0,5,0,2,20,0\n';
  assert.deepEqual(parseNutritionCsv(csv), { '2026-10-08': { kcal: 1211, protein: 125 }, '2026-10-09': { kcal: 300, protein: 20 } });
});
