import { getWeights } from '../../lib/db.js';
import { handler, HttpError } from '../../lib/http.js';

// GET /api/export?type=tage|koerper|blutdruck|blutwerte -> CSV (Excel-tauglich: ; und UTF-8-BOM)
const csvCell = v => {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (cols, rows) => '﻿' + [cols.map(c => c[0]).join(';'), ...rows.map(r => cols.map(c => csvCell(r[c[1]])).join(';'))].join('\r\n');

export const onRequestGet = handler(async ({ request, env }) => {
  const type = new URL(request.url).searchParams.get('type');
  let cols, rows;
  if (type === 'tage') {
    rows = (await env.DB.prepare(`SELECT d.*, s.steps AS sync_steps, n.kcal AS mfp_kcal, n.protein_g AS mfp_protein FROM days d
      LEFT JOIN sync_steps_daily s USING(entry_date) LEFT JOIN sync_nutrition_daily n USING(entry_date) ORDER BY entry_date`).all()).results;
    cols = [['Datum', 'entry_date'], ['Kraft', 'gym_kraft'], ['Kardio', 'gym_kardio'], ['Schritte (manuell)', 'steps'], ['Schritte (Sync)', 'sync_steps'],
      ['Walk km', 'walk_km'], ['kcal', 'calories_kcal'], ['kcal (MFP)', 'mfp_kcal'], ['Protein g', 'protein_g'], ['Protein (MFP)', 'mfp_protein'],
      ['Wasser ml', 'water_ml'], ['Bier', 'beer_count'], ['Notiz', 'note']];
  } else if (type === 'koerper') {
    rows = await getWeights(env.DB);
    cols = [['Datum', 'entry_date'], ['Gewicht kg', 'weight_kg'], ['Körperfett %', 'body_fat_pct'], ['Muskelmasse kg', 'muscle_kg'],
      ['Körperwasser kg', 'body_water_kg'], ['Grundumsatz kcal', 'bmr_kcal'], ['Quelle', 'source']];
  } else if (type === 'blutdruck') {
    rows = (await env.DB.prepare('SELECT * FROM blood_pressure ORDER BY entry_date, reading_time').all()).results;
    cols = [['Datum', 'entry_date'], ['Uhrzeit', 'reading_time'], ['Systolisch', 'systolic'], ['Diastolisch', 'diastolic'], ['Puls', 'pulse'], ['Notiz', 'note'], ['Quelle', 'source']];
  } else if (type === 'blutwerte') {
    rows = (await env.DB.prepare('SELECT * FROM lab_results ORDER BY entry_date, test_name').all()).results;
    cols = [['Datum', 'entry_date'], ['Test', 'test_name'], ['Wert', 'value'], ['Einheit', 'unit'], ['Notiz', 'note']];
  } else {
    throw new HttpError('Unbekannter Export');
  }
  return new Response(toCsv(cols, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="score-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
