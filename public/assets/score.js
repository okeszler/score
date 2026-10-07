// Gemeinsame Fachlogik: wird vom Browser UND von den Pages Functions importiert.
// Keine DOM- oder Worker-APIs verwenden.

export const DEFAULT_GOALS = {
  weight_kg: 85,
  body_fat_pct: 20,
  weekly_beer_budget: 6,
  kcal_target: 2000,
  protein_target: 140,
  steps_target: 10000,
  green_days_per_week: 5,
  start_weight_kg: null,
};

// 0,5 l Bier mit 5 % vol.: 500 ml * 0,05 * 0,789 g/ml
export const BEER = { ml: 500, alcoholG: 19.7, kcal: 215 };
// Grenzwert für einen "Risikotag" (g reiner Alkohol)
export const RISK_DAY_G = 24;
export const MIN_ALCOHOL_FREE_DAYS = 2;
// Grobe Schätzung kcal pro Schritt bei ~90 kg
export const KCAL_PER_STEP = 0.05;
export const STEPS_PER_KM = 1300;
export const KCAL_PER_KG_FAT = 7700;

export const STATUS = {
  green: { label: 'Grün', min: 7 },
  orange: { label: 'Orange', min: 4 },
  red: { label: 'Rot', min: 0 },
  none: { label: 'Kein Eintrag' },
};

export function mergeGoals(raw = {}) {
  const g = { ...DEFAULT_GOALS };
  for (const k of Object.keys(DEFAULT_GOALS)) {
    const v = raw[k];
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) g[k] = Number(v);
  }
  return g;
}

// ---------- Datum (immer lokale Kalendertage als 'YYYY-MM-DD') ----------

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // 12 Uhr: robust gegen Sommerzeit-Sprünge
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return isoDate(parseDate(s)) === s;
}

// Montag der Woche (ISO-Woche)
export function weekStart(s) {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7; // Mo=0
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

// ---------- Tageswerte ----------

// Effektive Schritte: manueller Wert > Sync > aus Walk-km geschätzt
export function effectiveSteps(day) {
  if (!day) return null;
  if (day.steps != null) return day.steps;
  if (day.synced_steps != null) return day.synced_steps;
  if (day.walk_km != null) return Math.round(day.walk_km * STEPS_PER_KM);
  return null;
}

export function caloriesTracked(day) {
  return !!day && (day.calories_tracked === 1 || day.calories_tracked === true || day.calories_kcal != null);
}

export function hasEntry(day) {
  return !!day && day.entry_date != null && day.created_at != null;
}

/**
 * Tages-Score 0–10.
 *  Bewegung (max 4): Schritte vs. Ziel (3 Punkte) + Training (1 Punkt)
 *  Ernährung (max 3): getrackt, kcal im Ziel, Protein erreicht
 *  Alkohol (max 3): 0 Bier = 3, 1 = 2, 2 = 1, ab 3 = 0; Wochenbudget überschritten = 0
 * @param beersBefore Biere in derselben Woche VOR diesem Tag
 */
export function scoreDay(day, goals, beersBefore = 0) {
  if (!hasEntry(day)) return { total: null, status: 'none', parts: null };
  const g = mergeGoals(goals);

  const steps = effectiveSteps(day);
  let stepPts = 0;
  if (steps != null) {
    const r = steps / g.steps_target;
    stepPts = r >= 1 ? 3 : r >= 0.75 ? 2 : r >= 0.5 ? 1 : 0;
  }
  const trained = !!(day.gym_kraft || day.gym_kardio);
  const bewegung = Math.min(4, stepPts + (trained ? 1 : 0));

  let ernaehrung = 0;
  if (caloriesTracked(day)) {
    ernaehrung += 1;
    if (day.calories_kcal != null && day.calories_kcal <= g.kcal_target) ernaehrung += 1;
    if (day.protein_g != null && day.protein_g >= g.protein_target) ernaehrung += 1;
  }

  const beers = day.beer_count || 0;
  let alkohol = [3, 2, 1][beers] ?? 0;
  if (beers > 0 && beersBefore + beers > g.weekly_beer_budget) alkohol = 0;

  const total = bewegung + ernaehrung + alkohol;
  return { total, status: statusFor(total), parts: { bewegung, ernaehrung, alkohol }, steps };
}

export function statusFor(total) {
  if (total == null) return 'none';
  if (total >= STATUS.green.min) return 'green';
  if (total >= STATUS.orange.min) return 'orange';
  return 'red';
}

/** Scores für alle Tage berechnen; berücksichtigt das laufende Wochenbudget. */
export function scoreAll(daysByDate, goals) {
  const dates = Object.keys(daysByDate).sort();
  const beersInWeek = {};
  const out = {};
  for (const date of dates) {
    const day = daysByDate[date];
    const wk = weekStart(date);
    const before = beersInWeek[wk] || 0;
    out[date] = scoreDay(day, goals, before);
    if (hasEntry(day)) beersInWeek[wk] = before + (day.beer_count || 0);
  }
  return out;
}

// ---------- Wochen ----------

export function weekSummary(daysByDate, scores, goals, monday, today) {
  const g = mergeGoals(goals);
  const days = [];
  let green = 0, logged = 0, beers = 0, alcoholFree = 0, riskDays = 0, trainings = 0;
  let stepsSum = 0, stepsN = 0, kcalSum = 0, kcalN = 0, scoreSum = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const day = daysByDate[date];
    const sc = scores[date] || { total: null, status: 'none' };
    const future = today && date > today;
    days.push({ date, day, score: sc, future });
    if (!hasEntry(day)) continue;
    logged++;
    scoreSum += sc.total;
    if (sc.status === 'green') green++;
    const b = day.beer_count || 0;
    beers += b;
    if (b === 0) alcoholFree++;
    if (b * BEER.alcoholG > RISK_DAY_G) riskDays++;
    if (day.gym_kraft || day.gym_kardio) trainings++;
    const st = effectiveSteps(day);
    if (st != null) { stepsSum += st; stepsN++; }
    if (day.calories_kcal != null) { kcalSum += day.calories_kcal; kcalN++; }
  }
  return {
    monday, days, green, logged, beers, alcoholFree, riskDays, trainings,
    goalGreen: g.green_days_per_week,
    reached: green >= g.green_days_per_week,
    avgScore: logged ? scoreSum / logged : null,
    avgSteps: stepsN ? Math.round(stepsSum / stepsN) : null,
    avgKcal: kcalN ? Math.round(kcalSum / kcalN) : null,
    alcoholG: beers * BEER.alcoholG,
    alcoholBudgetG: g.weekly_beer_budget * BEER.alcoholG,
    beerBudget: g.weekly_beer_budget,
    beerLeft: g.weekly_beer_budget - beers,
  };
}

/** Grüne Tage in Folge, endend heute (oder gestern, falls heute noch nichts eingetragen ist). */
export function activeStreak(scores, today) {
  let d = today;
  if (!scores[d] || scores[d].status === 'none') d = addDays(d, -1);
  let n = 0;
  while (scores[d] && scores[d].status === 'green') { n++; d = addDays(d, -1); }
  return n;
}

/** Wochen in Folge mit erreichtem Wochenziel (aktuelle Woche zählt nur, wenn schon erreicht). */
export function weekStreak(daysByDate, scores, goals, today) {
  let monday = weekStart(today);
  const current = weekSummary(daysByDate, scores, goals, monday, today);
  let n = current.reached ? 1 : 0;
  for (let i = 0; i < 520; i++) {
    monday = addDays(monday, -7);
    if (!weekSummary(daysByDate, scores, goals, monday, today).reached) break;
    n++;
  }
  return n;
}

// ---------- Gewicht ----------

/** Lineare Regression über die letzten `windowDays` Tage. Liefert kg/Woche und Prognose. */
export function weightTrend(weights, goalKg, today, windowDays = 42) {
  const pts = weights
    .filter(w => w.weight_kg != null && daysBetween(w.entry_date, today) <= windowDays)
    .map(w => ({ x: daysBetween(today, w.entry_date), y: w.weight_kg }));
  if (pts.length < 2) return null;
  const span = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
  if (span < 7) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  const slope = num / den; // kg pro Tag
  const nowKg = my + slope * (0 - mx);
  const perWeek = slope * 7;
  let eta = null;
  if (goalKg != null && slope < -0.005 && nowKg > goalKg) {
    const days = Math.ceil((nowKg - goalKg) / -slope);
    if (days < 365 * 5) eta = addDays(today, days);
  }
  return { perWeek, nowKg, eta, points: n };
}

/** Wie viel Defizit pro Tag nötig wäre, um das Ziel bis `targetDate` zu erreichen. */
export function requiredDailyDeficit(currentKg, goalKg, today, targetDate) {
  const days = daysBetween(today, targetDate);
  if (days <= 0 || currentKg <= goalKg) return null;
  return Math.round(((currentKg - goalKg) * KCAL_PER_KG_FAT) / days);
}

/** "Noch ein Bier?" – Auswirkungen von +1 Bier heute. */
export function beerDecision(daysByDate, goals, today) {
  const g = mergeGoals(goals);
  const day = daysByDate[today] || { entry_date: today, created_at: 'preview', beer_count: 0 };
  const entry = hasEntry(day) ? day : { ...day, created_at: 'preview' };
  const monday = weekStart(today);
  let before = 0;
  for (let d = monday; d < today; d = addDays(d, 1)) before += daysByDate[d]?.beer_count || 0;
  const todayBeers = entry.beer_count || 0;
  const now = scoreDay(entry, g, before);
  const next = scoreDay({ ...entry, beer_count: todayBeers + 1 }, g, before);
  const weekAfter = before + todayBeers + 1;
  const alcoholTodayG = (todayBeers + 1) * BEER.alcoholG;
  const reasons = [];
  if (weekAfter > g.weekly_beer_budget) reasons.push(`Wochenbudget überschritten (${weekAfter} / ${g.weekly_beer_budget})`);
  if (alcoholTodayG > RISK_DAY_G) reasons.push(`Risikotag: ${Math.round(alcoholTodayG)} g Alkohol heute`);
  if (now.status !== next.status) reasons.push(`Tag fällt von ${STATUS[now.status].label} auf ${STATUS[next.status].label}`);
  const verdict = reasons.length === 0 ? 'ok' : reasons.length === 1 && weekAfter <= g.weekly_beer_budget ? 'meh' : 'no';
  return {
    todayBeers, weekBefore: before + todayBeers, weekAfter, budget: g.weekly_beer_budget,
    scoreNow: now.total, scoreNext: next.total, statusNow: now.status, statusNext: next.status,
    alcoholTodayG, kcal: BEER.kcal, stepsToBurn: Math.round(BEER.kcal / KCAL_PER_STEP),
    reasons, verdict,
  };
}
