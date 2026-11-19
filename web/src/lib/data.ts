import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, get } from './api';
import { METRICS, tzMinutes, type Day, type Units } from './metrics';

// ---- units (kept on this device)

let units: Units = (() => {
  try {
    return localStorage.getItem('hc.units') === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
})();
const unitListeners = new Set<() => void>();

export function setUnits(u: Units) {
  units = u;
  try {
    localStorage.setItem('hc.units', u);
  } catch {
    /* ignore */
  }
  unitListeners.forEach((l) => l());
}

export const currentUnits = (): Units => units;

export function useUnits(): Units {
  return useSyncExternalStore(
    (cb) => {
      unitListeners.add(cb);
      return () => unitListeners.delete(cb);
    },
    () => units,
  );
}

// ---- fetching

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Showing the copy saved on this device; the server couldn't be reached. */
  stale: boolean;
  reload: () => void;
}

/** Fetch with the previous result kept on screen while a new one loads. */
export function useFetch<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; stale: boolean; loading: boolean }>({
    data: null, error: null, stale: false, loading: !!path,
  });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    get<T>(path)
      .then((r) => n === seq.current && setState({ data: r.data, error: null, stale: r.stale, loading: false }))
      .catch((e) => {
        if (n !== seq.current) return;
        if (e instanceof ApiError && e.status === 401) window.dispatchEvent(new Event('hc:signed-out'));
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Something went wrong', loading: false }));
      });
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // On-device mode: new data has been read from Health Connect.
  useEffect(() => {
    window.addEventListener('hc:data-changed', reload);
    return () => window.removeEventListener('hc:data-changed', reload);
  }, [reload]);
  return { ...state, reload };
}

export type Daily = Record<string, Day[]>;

export function useDaily(types: string[], days: number) {
  const known = types.filter((t) => t in METRICS);
  return useFetch<Daily>(`/api/daily?types=${known.join(',')}&days=${days}&tz=${tzMinutes()}`);
}

export interface RecordRow {
  type: string;
  start: string;
  end: string;
  source: string;
  value: number | null;
  extra: Record<string, any> | null;
  unit: string;
}

export function useRecords(type: string, sinceIso: string, limit = 200) {
  return useFetch<RecordRow[]>(`/api/records?type=${type}&since=${encodeURIComponent(sinceIso)}&limit=${limit}`);
}

export const useLatest = () => useFetch<Record<string, { start: string; end: string; value: number; unit: string; extra: any }>>('/api/latest');

// ---- the range filter shared by every screen

let range = 30;
const rangeListeners = new Set<() => void>();
export const RANGES = [7, 30, 90, 365];

export function setRange(n: number) {
  range = n;
  rangeListeners.forEach((l) => l());
}

export function useRange(): number {
  return useSyncExternalStore(
    (cb) => {
      rangeListeners.add(cb);
      return () => rangeListeners.delete(cb);
    },
    () => range,
  );
}

// ---- bar or line, remembered per metric on this device

export type ChartKind = 'bar' | 'line';

export function useChartKind(metric: string, fallback: ChartKind): [ChartKind, () => void] {
  const key = `hc.chartkind.${metric}`;
  const [kind, setKind] = useState<ChartKind>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === 'bar' || v === 'line' ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const toggle = () => {
    const next: ChartKind = kind === 'bar' ? 'line' : 'bar';
    setKind(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* ignore */
    }
  };
  return [kind, toggle];
}

// ---- colour by value on or off, remembered per metric on this device (on unless turned off)

export function useRated(metric: string): [boolean, () => void] {
  const key = `hc.rated.${metric}`;
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOn(!on);
    try {
      localStorage.setItem(key, on ? '0' : '1');
    } catch {
      /* ignore */
    }
  };
  return [on, toggle];
}
