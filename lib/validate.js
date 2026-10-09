import { HttpError } from './http.js';
import { isValidDate } from '../public/assets/score.js';

export function assertDate(s) {
  if (!isValidDate(s)) throw new HttpError('Ungültiges Datum (erwartet YYYY-MM-DD)');
  return s;
}

/** Zahl in [min, max] oder null (leer). */
export function num(v, name, min, max, { int = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n)) throw new HttpError(`${name}: keine gültige Zahl`);
  if (n < min || n > max) throw new HttpError(`${name}: muss zwischen ${min} und ${max} liegen`);
  return int ? Math.round(n) : Math.round(n * 100) / 100;
}

export function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0;
}

export function text(v, max = 500) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(`Notiz zu lang (max. ${max} Zeichen)`);
  return s;
}

export function dayFromBody(b) {
  const kcal = num(b.calories_kcal, 'Kalorien', 0, 10000, { int: true });
  return {
    gym_kraft: bool(b.gym_kraft),
    gym_kardio: bool(b.gym_kardio),
    walk_km: num(b.walk_km, 'Walk', 0, 100),
    steps: num(b.steps, 'Schritte', 0, 150000, { int: true }),
    // "getrackt" folgt aus dem kcal-Wert – kein widersprüchlicher Zustand mehr möglich
    calories_tracked: kcal != null || bool(b.calories_tracked) ? 1 : 0,
    calories_kcal: kcal,
    protein_g: num(b.protein_g, 'Protein', 0, 600, { int: true }),
    water_ml: num(b.water_ml, 'Wasser', 0, 15000, { int: true }),
    beer_count: num(b.beer_count, 'Bier', 0, 40, { int: true }) ?? 0,
    note: text(b.note),
  };
}

export function weightFromBody(b) {
  const weight_kg = num(b.weight_kg, 'Gewicht', 30, 300);
  const body_fat_pct = num(b.body_fat_pct, 'Körperfett', 2, 70);
  if (weight_kg == null && body_fat_pct == null) throw new HttpError('Gewicht oder Körperfett angeben');
  return { weight_kg, body_fat_pct };
}

export const GOAL_LIMITS = {
  weight_kg: [40, 250],
  body_fat_pct: [3, 60],
  weekly_beer_budget: [0, 50],
  kcal_target: [800, 6000],
  protein_target: [0, 400],
  water_target: [250, 8000],
  steps_target: [1000, 50000],
  green_days_per_week: [1, 7],
  start_weight_kg: [40, 300],
};
