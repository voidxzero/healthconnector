import { health } from './health';
import { TYPES, addLocal, clearLocal, persistLocal, utc, type LocalRec } from './localdata';

const LAST = 'hc.local.lastSync';
const ERR = 'hc.local.error';
const VER = 'hc.local.v';
/** Bump when records gain new detail, so the next refresh reads the whole range again. 2 = sleep segments. */
const DATA_VERSION = '2';
const DAY = 86400000;
const MIN_GAP_MS = 2 * 60000;
const OVERLAP_MS = 7 * DAY; // re-read a few days, like the server sync: late data lands, and re-reading is harmless
const HORIZON_MS = 90 * DAY; // the phone clamps this to 30 days unless "past data" is allowed
const WINDOW_MS = 7 * DAY;
// Types that can have thousands of records a week (a watch writing every few minutes) are read a week at a time,
// so no single answer through the app bridge is huge.
const HEAVY = new Set(['steps', 'heart_rate', 'distance', 'active_calories', 'total_calories']);

const read = (k: string) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export const localLastSync = (): number => Number(read(LAST) || 0);
/** What went wrong in the last refresh, or "" if it was fine. */
export const localError = (): string => read(ERR);

let running: Promise<number | null> | null = null;

/**
 * Reads Health Connect into the phone's own store (on-device mode).
 * Returns the number of records read, or null if there's nothing to read yet
 * (Health Connect missing, or nothing allowed). Quiet if run again too soon.
 * A data type that fails is skipped and reported (localError()); the rest still load.
 */
export function localRefresh(force = false): Promise<number | null> {
  if (running) return running;
  if (!force && Date.now() - localLastSync() < MIN_GAP_MS) return Promise.resolve(null);
  running = (async () => {
    if (!health) return null;
    const st = await health.status();
    if (st.sdk !== 'available' || st.missing >= st.total) return null;
    const startedAt = Date.now();
    const last = read(VER) === DATA_VERSION ? localLastSync() : 0;
    const from = last ? Math.max(last - OVERLAP_MS, startedAt - HORIZON_MS) : startedAt - HORIZON_MS;
    const problems: string[] = [];
    let n = 0;
    let lastShown = 0;

    const take = async (type: string, sinceMs: number, untilMs: number) => {
      const { records } = await health!.readRecords({ type, sinceMs, untilMs });
      const recs: LocalRec[] = records.map((r: any) => {
        const start = utc(r.start);
        return { type: r.type, start, end: r.end ? utc(r.end) : start, source: r.source ?? '', value: r.value ?? null, extra: r.extra ?? null };
      });
      await addLocal(recs);
      n += recs.length;
    };

    try {
      for (const type of Object.keys(TYPES)) {
        try {
          if (HEAVY.has(type)) {
            for (let to = startedAt; to > from; to -= WINDOW_MS) await take(type, Math.max(from, to - WINDOW_MS), to);
          } else {
            await take(type, from, 0);
          }
        } catch (e: any) {
          problems.push(`${type}: ${e?.message || e}`);
        }
        // Let the dashboard fill in as data arrives, not only at the end.
        if (Date.now() - lastShown > 1500) {
          lastShown = Date.now();
          window.dispatchEvent(new Event('hc:data-changed'));
        }
      }
    } finally {
      await persistLocal();
    }
    write(ERR, problems.join('; '));
    if (!problems.length) {
      write(LAST, String(startedAt)); // otherwise the next refresh reads the whole range again
      write(VER, DATA_VERSION);
    }
    window.dispatchEvent(new Event('hc:data-changed'));
    if (!problems.length) window.dispatchEvent(new Event('hc:synced'));
    return n;
  })()
    .catch((e: any) => {
      write(ERR, String(e?.message || e));
      throw e;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** Forget everything kept on this phone (the data in Health Connect itself is untouched). */
export async function clearLocalData() {
  await clearLocal();
  write(LAST, '');
  write(ERR, '');
  window.dispatchEvent(new Event('hc:data-changed'));
}
