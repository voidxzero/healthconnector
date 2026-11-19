/**
 * On-device mode: the phone keeps its own copy of the records and answers the
 * same queries the server would (/api/daily, /api/records, /api/latest), so the
 * dashboard doesn't know the difference.
 *
 * Keep the rules here identical to app.py (`daily`, `records`, `latest`): sum
 * types add up per day and take the largest single source; the rest average;
 * sleep belongs to the day it ends; days are the viewer's local days.
 *
 * This file imports nothing from the rest of the app, so api.ts can use it.
 */

export interface LocalRec {
  type: string;
  start: string;
  end: string;
  source: string;
  value: number | null;
  extra: Record<string, any> | null;
}

/** type -> [unit, kind]. Same table as TYPES in app.py. */
export const TYPES: Record<string, [string, 'sum' | 'avg']> = {
  sleep: ['min', 'sum'], steps: ['count', 'sum'], distance: ['m', 'sum'], active_calories: ['kcal', 'sum'],
  total_calories: ['kcal', 'sum'], hydration: ['L', 'sum'], nutrition: ['kcal', 'sum'], exercise: ['min', 'sum'],
  heart_rate: ['bpm', 'avg'], resting_heart_rate: ['bpm', 'avg'], hrv: ['ms', 'avg'], weight: ['kg', 'avg'],
  body_fat: ['%', 'avg'], height: ['m', 'avg'], blood_pressure: ['mmHg', 'avg'], blood_glucose: ['mmol/L', 'avg'],
  oxygen_saturation: ['%', 'avg'], body_temperature: ['°C', 'avg'], respiratory_rate: ['/min', 'avg'],
};

const DAY_BY_END = new Set(['sleep']);
const DAY_MS = 86400000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** "2026-11-17T22:30:00.123+02:00" -> "2026-11-17T20:30:00Z", like the server's utc(). */
export function utc(s: string): string {
  return new Date(s).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const recKey = (r: Pick<LocalRec, 'type' | 'start' | 'end' | 'source'>) => `${r.type}|${r.start}|${r.end}|${r.source}`;

/** The local calendar date (YYYY-MM-DD) of an instant, for a viewer `tz` minutes ahead of UTC. */
const dayOf = (iso: string, tz: number) => new Date(Date.parse(iso) + tz * 60000).toISOString().slice(0, 10);

export interface DayRow { date: string; value: number; min?: number; max?: number; count: number }

export function daily(recs: Iterable<LocalRec>, types: string[], days: number, tz: number, now = Date.now()): Record<string, DayRow[]> {
  days = clamp(Math.trunc(days) || 30, 1, 400);
  tz = clamp(Math.trunc(tz) || 0, -840, 840);
  const first = dayOf(new Date(now - (days - 1) * DAY_MS).toISOString(), tz);
  const want = new Set(types);
  const out: Record<string, DayRow[]> = {};
  const sums = new Map<string, Map<string, Map<string, { v: number; n: number }>>>(); // type -> day -> source -> total
  const avgs = new Map<string, Map<string, number[]>>(); // type -> day -> values
  const counts = new Map<string, Map<string, number>>(); // avg types: all rows, nulls included, like COUNT(*)
  for (const t of want) {
    if (TYPES[t]) out[t] = [];
    sums.set(t, new Map());
    avgs.set(t, new Map());
    counts.set(t, new Map());
  }
  for (const r of recs) {
    if (!want.has(r.type) || !TYPES[r.type]) continue;
    const d = dayOf(DAY_BY_END.has(r.type) ? r.end : r.start, tz);
    if (d < first) continue;
    if (TYPES[r.type][1] === 'sum') {
      const byDay = sums.get(r.type)!;
      const bySrc = byDay.get(d) ?? new Map();
      const cur = bySrc.get(r.source) ?? { v: 0, n: 0 };
      cur.v += r.value ?? 0; // SQL SUM ignores NULL
      cur.n += 1;
      bySrc.set(r.source, cur);
      byDay.set(d, bySrc);
    } else {
      const c = counts.get(r.type)!;
      c.set(d, (c.get(d) ?? 0) + 1);
      if (r.value !== null) {
        const byDay = avgs.get(r.type)!;
        byDay.set(d, [...(byDay.get(d) ?? []), r.value]);
      }
    }
  }
  for (const t of want) {
    if (!TYPES[t]) continue;
    if (TYPES[t][1] === 'sum') {
      for (const [date, bySrc] of sums.get(t)!) {
        const totals = [...bySrc.values()];
        out[t].push({ date, value: Math.max(...totals.map((x) => x.v)), count: totals.reduce((a, x) => a + x.n, 0) });
      }
    } else {
      for (const [date, vals] of avgs.get(t)!) {
        out[t].push({ date, value: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), count: counts.get(t)!.get(date)! });
      }
    }
    out[t].sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

export function recordsOf(recs: Iterable<LocalRec>, type: string, since: string, limit: number) {
  const from = since ? utc(since) : '';
  return [...recs]
    .filter((r) => r.type === type && r.start >= from)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, clamp(Math.trunc(limit) || 200, 1, 2000))
    .map((r) => ({ ...r, unit: TYPES[type]?.[0] ?? '' }));
}

export function latestOf(recs: Iterable<LocalRec>) {
  const best = new Map<string, LocalRec>();
  for (const r of recs) {
    const b = best.get(r.type);
    if (TYPES[r.type] && (!b || r.start > b.start)) best.set(r.type, r);
  }
  return Object.fromEntries([...best].map(([t, r]) => [t, { start: r.start, end: r.end, value: r.value, unit: TYPES[t][0], extra: r.extra }]));
}

// ---- storage: one IndexedDB value (a few thousand to ~100k small records), also kept in memory

const DB = 'hc-local';
const STORE = 'kv';
let mem: Map<string, LocalRec> | null = null;
let loading: Promise<Map<string, LocalRec>> | null = null;

const idb = (): Promise<IDBDatabase> =>
  new Promise((res, rej) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(open.error);
  });

async function idbGet(): Promise<LocalRec[]> {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).get('records');
    req.onsuccess = () => res((req.result as LocalRec[]) ?? []);
    req.onerror = () => rej(req.error);
  });
}

async function idbPut(recs: LocalRec[] | null): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (recs === null) tx.objectStore(STORE).delete('records');
    else tx.objectStore(STORE).put(recs, 'records');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export function loadLocal(): Promise<Map<string, LocalRec>> {
  if (mem) return Promise.resolve(mem);
  loading ??= idbGet()
    .catch(() => [] as LocalRec[])
    .then((list) => (mem = new Map(list.map((r) => [recKey(r), r]))));
  return loading;
}

/** Add or replace records in memory (same key = same record, so re-reading is harmless). Call persistLocal() to save. */
export async function addLocal(recs: LocalRec[]): Promise<void> {
  const m = await loadLocal();
  for (const r of recs) m.set(recKey(r), r);
}

/** Save what's in memory. Done once per refresh, not per chunk: rewriting everything each time gets slow with a big history. */
export async function persistLocal(): Promise<void> {
  const m = await loadLocal();
  await idbPut([...m.values()]).catch(() => {});
}

export async function clearLocal(): Promise<void> {
  mem = new Map();
  loading = null;
  await idbPut(null).catch(() => {});
}

/** Answers the dashboard's GETs from the local copy. undefined = not something that exists without a server. */
export async function localQuery(path: string): Promise<unknown | undefined> {
  const u = new URL(path, 'http://local');
  const q = u.searchParams;
  const recs = (await loadLocal()).values();
  switch (u.pathname) {
    case '/api/daily':
      return daily(recs, (q.get('types') ?? '').split(',').filter(Boolean), Number(q.get('days') ?? 30), Number(q.get('tz') ?? 0));
    case '/api/records':
      return recordsOf(recs, q.get('type') ?? '', q.get('since') ?? '', Number(q.get('limit') ?? 200));
    case '/api/latest':
      return latestOf(recs);
    default:
      return undefined;
  }
}
