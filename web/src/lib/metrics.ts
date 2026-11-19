export type Units = 'metric' | 'imperial';
export type Color = 'blue' | 'orange' | 'aqua' | 'violet' | 'red' | 'green' | 'magenta' | 'yellow';

export interface Metric {
  key: string;
  label: string;
  /** "sum" metrics add up over a day (steps); the rest are averaged (heart rate). */
  kind: 'sum' | 'avg';
  color: Color;
  /** Stored unit -> what's shown. */
  unit: (u: Units) => string;
  conv: (v: number, u: Units) => number;
  digits: number;
  /** Shown as hours and minutes; the stored value is minutes. */
  duration?: boolean;
  /** Where the y axis starts for line charts that shouldn't be forced to zero. */
  floorZero?: boolean;
}

const id = (v: number) => v;
const same = (s: string) => () => s;

export const METRICS: Record<string, Metric> = {
  sleep: { key: 'sleep', label: 'Sleep', kind: 'sum', color: 'violet', unit: same('h'), conv: (v) => v / 60, digits: 1, duration: true, floorZero: true },
  steps: { key: 'steps', label: 'Steps', kind: 'sum', color: 'blue', unit: same('steps'), conv: id, digits: 0, floorZero: true },
  distance: { key: 'distance', label: 'Distance', kind: 'sum', color: 'green', unit: (u) => (u === 'metric' ? 'km' : 'mi'), conv: (v, u) => (u === 'metric' ? v / 1000 : v / 1609.344), digits: 1, floorZero: true },
  active_calories: { key: 'active_calories', label: 'Active calories', kind: 'sum', color: 'orange', unit: same('kcal'), conv: id, digits: 0, floorZero: true },
  total_calories: { key: 'total_calories', label: 'Total calories', kind: 'sum', color: 'magenta', unit: same('kcal'), conv: id, digits: 0, floorZero: true },
  exercise: { key: 'exercise', label: 'Exercise', kind: 'sum', color: 'aqua', unit: same('min'), conv: id, digits: 0, floorZero: true },
  heart_rate: { key: 'heart_rate', label: 'Heart rate', kind: 'avg', color: 'red', unit: same('bpm'), conv: id, digits: 0 },
  resting_heart_rate: { key: 'resting_heart_rate', label: 'Resting heart rate', kind: 'avg', color: 'orange', unit: same('bpm'), conv: id, digits: 0 },
  hrv: { key: 'hrv', label: 'Heart rate variability', kind: 'avg', color: 'violet', unit: same('ms'), conv: id, digits: 0 },
  oxygen_saturation: { key: 'oxygen_saturation', label: 'Blood oxygen', kind: 'avg', color: 'blue', unit: same('%'), conv: id, digits: 1 },
  blood_pressure: { key: 'blood_pressure', label: 'Blood pressure', kind: 'avg', color: 'blue', unit: same('mmHg'), conv: id, digits: 0 },
  respiratory_rate: { key: 'respiratory_rate', label: 'Breathing rate', kind: 'avg', color: 'aqua', unit: same('/min'), conv: id, digits: 0 },
  body_temperature: { key: 'body_temperature', label: 'Body temperature', kind: 'avg', color: 'magenta', unit: (u) => (u === 'metric' ? '°C' : '°F'), conv: (v, u) => (u === 'metric' ? v : v * 1.8 + 32), digits: 1 },
  blood_glucose: { key: 'blood_glucose', label: 'Blood glucose', kind: 'avg', color: 'green', unit: same('mmol/L'), conv: id, digits: 1 },
  weight: { key: 'weight', label: 'Weight', kind: 'avg', color: 'blue', unit: (u) => (u === 'metric' ? 'kg' : 'lb'), conv: (v, u) => (u === 'metric' ? v : v * 2.2046226), digits: 1 },
  body_fat: { key: 'body_fat', label: 'Body fat', kind: 'avg', color: 'orange', unit: same('%'), conv: id, digits: 1 },
  height: { key: 'height', label: 'Height', kind: 'avg', color: 'aqua', unit: (u) => (u === 'metric' ? 'cm' : 'in'), conv: (v, u) => (u === 'metric' ? v * 100 : v * 39.370079), digits: 0 },
  hydration: { key: 'hydration', label: 'Hydration', kind: 'sum', color: 'aqua', unit: (u) => (u === 'metric' ? 'L' : 'fl oz'), conv: (v, u) => (u === 'metric' ? v : v * 33.814), digits: 1, floorZero: true },
  nutrition: { key: 'nutrition', label: 'Food energy', kind: 'sum', color: 'green', unit: same('kcal'), conv: id, digits: 0, floorZero: true },
};

export const num = (v: number, digits: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });

export function hm(minutes: number): string {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "7h 30m", "8,421", "5.2". Takes the stored value. */
export function fmt(m: Metric, stored: number, u: Units): string {
  return m.duration ? hm(stored) : num(m.conv(stored, u), m.digits);
}

export const withUnit = (m: Metric, stored: number, u: Units) =>
  m.duration ? hm(stored) : `${fmt(m, stored, u)} ${m.unit(u)}`;

// ---- dates (all local, like the server's per-day grouping)

export const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const tzMinutes = () => -new Date().getTimezoneOffset();

/** The last n local dates, oldest first. */
export function lastDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(localDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Local midnight n days ago, as an instant. Stable for the whole day, so it's safe in a request URL. */
export function sinceIso(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export const dateLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts);

export const timeLabel = (utc: string) =>
  new Date(utc).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export interface Day {
  date: string;
  value: number;
  min?: number;
  max?: number;
  count: number;
}

export const EXERCISE_NAMES: Record<string, string> = {
  running: 'Running', walking: 'Walking', biking: 'Cycling', biking_stationary: 'Stationary bike',
  swimming_pool: 'Pool swim', swimming_open_water: 'Open-water swim', hiking: 'Hiking',
  strength_training: 'Strength training', weightlifting: 'Weightlifting', yoga: 'Yoga', pilates: 'Pilates',
  elliptical: 'Elliptical', rowing: 'Rowing', rowing_machine: 'Rowing machine', stair_climbing: 'Stair climbing',
  high_intensity_interval_training: 'HIIT', dancing: 'Dancing', calisthenics: 'Calisthenics', golf: 'Golf',
  tennis: 'Tennis', soccer: 'Soccer', basketball: 'Basketball', skiing: 'Skiing', other_workout: 'Workout',
};

export const exerciseName = (t?: string) =>
  (t && EXERCISE_NAMES[t]) || (t ? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Workout');

// ---- value-based colour: what a day's number means differs per graph, so each metric has its own scale

export type Tone = 'red' | 'amber' | 'green' | 'blue';
/** From this value on (stored units) the colour is `tone`, blending to the next stop. Ascending by `at`. */
export interface Stop { at: number; tone: Tone; label: string }

/**
 * Red = poor, amber = so-so, green = in the healthy range, blue = unusually much (or, for resting heart rate, unusually low).
 * These are typical adult ranges, not medical advice; they are the only place to change them.
 * Every zone also has a text label, because red and green are the pair many colour-blind people can't tell apart.
 */
export const SCALES: Record<string, Stop[]> = {
  sleep: [
    { at: 300, tone: 'red', label: 'Too little' },
    { at: 360, tone: 'amber', label: 'A bit short' },
    { at: 420, tone: 'green', label: 'Healthy' },
    { at: 540, tone: 'green', label: 'Healthy' },
    { at: 600, tone: 'blue', label: 'Long' },
  ],
  steps: [
    { at: 2000, tone: 'red', label: 'Very low' },
    { at: 5000, tone: 'amber', label: 'Below goal' },
    { at: 8000, tone: 'green', label: 'Active' },
    { at: 15000, tone: 'green', label: 'Active' },
    { at: 25000, tone: 'blue', label: 'Very high' },
  ],
  exercise: [
    { at: 0, tone: 'red', label: 'None' },
    { at: 15, tone: 'amber', label: 'Light' },
    { at: 30, tone: 'green', label: 'Good' },
    { at: 90, tone: 'green', label: 'Good' },
    { at: 180, tone: 'blue', label: 'Very long' },
  ],
  hydration: [
    { at: 0.5, tone: 'red', label: 'Very low' },
    { at: 1.2, tone: 'amber', label: 'Low' },
    { at: 2, tone: 'green', label: 'Good' },
    { at: 3.5, tone: 'green', label: 'Good' },
    { at: 5, tone: 'blue', label: 'Very high' },
  ],
  resting_heart_rate: [
    { at: 40, tone: 'blue', label: 'Very low' },
    { at: 50, tone: 'green', label: 'Healthy' },
    { at: 70, tone: 'green', label: 'Healthy' },
    { at: 85, tone: 'amber', label: 'Raised' },
    { at: 100, tone: 'red', label: 'High' },
  ],
  oxygen_saturation: [
    { at: 90, tone: 'red', label: 'Low' },
    { at: 93, tone: 'amber', label: 'A bit low' },
    { at: 95, tone: 'green', label: 'Normal' },
  ],
};

// The status colours (never themed) and the series blue; see styles.css.
const TONE: Record<Tone, string> = { red: 'var(--s-critical)', amber: 'var(--s-warning)', green: 'var(--s-good)', blue: 'var(--c-blue)' };

/** The colour for a stored value: blends smoothly between the neighbouring stops. */
export function scaleColor(stops: Stop[], v: number): string {
  if (v <= stops[0].at) return TONE[stops[0].tone];
  const last = stops[stops.length - 1];
  if (v >= last.at) return TONE[last.tone];
  const i = stops.findIndex((st, k) => v >= st.at && v <= stops[k + 1].at);
  const a = stops[i], b = stops[i + 1];
  if (a.tone === b.tone) return TONE[a.tone];
  const keep = Math.round((1 - (v - a.at) / (b.at - a.at)) * 100); // how much of the lower stop's colour is left
  if (keep >= 100) return TONE[a.tone];
  if (keep <= 0) return TONE[b.tone];
  return `color-mix(in oklab, ${TONE[a.tone]} ${keep}%, ${TONE[b.tone]})`;
}

/** The word for a stored value: the label of the nearest stop. */
export function scaleLabel(stops: Stop[], v: number): string {
  let best = stops[0], d = Math.abs(v - stops[0].at);
  for (const st of stops) {
    const e = Math.abs(v - st.at);
    if (e < d) { best = st; d = e; }
  }
  return best.label;
}

/** One entry per zone for the legend: a swatch, its word and the range it covers. */
export function scaleLegend(m: Metric, stops: Stop[], u: Units): { color: string; label: string; range: string }[] {
  const f = (v: number) => (m.duration ? `${+(v / 60).toFixed(1)}h` : `${num(m.conv(v, u), m.digits)}${m.unit(u) === 'steps' ? '' : ' ' + m.unit(u)}`);
  const groups: Stop[][] = [];
  for (const st of stops) {
    const g = groups[groups.length - 1];
    if (g && g[0].label === st.label) g.push(st);
    else groups.push([st]);
  }
  return groups.map((g, i) => {
    const lo = g[0].at, hi = g[g.length - 1].at;
    const range = groups.length === 1 ? '' : i === 0 ? `up to ${f(hi)}` : i === groups.length - 1 ? `${f(lo)} and over` : lo === hi ? `about ${f(lo)}` : `${f(lo)} to ${f(hi)}`;
    return { color: TONE[g[0].tone], label: g[0].label, range };
  });
}

/** The glyph for each metric (names in components/icons.tsx), drawn on its Overview box. */
export const METRIC_ICONS: Record<string, string> = {
  sleep: 'moon',
  steps: 'walk',
  distance: 'pin',
  active_calories: 'flame',
  total_calories: 'flame',
  exercise: 'dumbbell',
  heart_rate: 'pulse',
  resting_heart_rate: 'heart',
  hrv: 'line',
  oxygen_saturation: 'drop',
  blood_pressure: 'gauge',
  respiratory_rate: 'air',
  body_temperature: 'thermo',
  blood_glucose: 'drop',
  weight: 'scale',
  body_fat: 'percent',
  height: 'ruler2',
  hydration: 'drop',
  nutrition: 'food',
};
