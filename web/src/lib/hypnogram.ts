import type { Color } from './metrics';

/** deep, light, REM, awake */
export type StageCode = 'd' | 'l' | 'r' | 'a';
/** [minutes after the night began, minutes long, stage], as the phone sends them. */
export type Segment = [number, number, StageCode];

/** Top to bottom: awake at the top, deep at the bottom, like the sleep graphs in other health apps. */
export const LANES: StageCode[] = ['a', 'r', 'l', 'd'];

export const STAGE: Record<StageCode, { label: string; color: Color }> = {
  d: { label: 'Deep', color: 'blue' },
  l: { label: 'Light', color: 'orange' },
  r: { label: 'REM', color: 'aqua' },
  a: { label: 'Awake', color: 'yellow' },
};

/** Keeps what looks like a segment and drops the rest (a record from an older version, or a damaged one). */
export function parseSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Segment => Array.isArray(s) && s.length === 3 && Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] > 0 && s[2] in STAGE)
    .sort((a, b) => a[0] - b[0]);
}

export interface Block {
  x: number;
  w: number;
  lane: number;
  code: StageCode;
  /** Minutes after the night began, and minutes long. */
  at: number;
  dur: number;
}

/** Where each segment goes on a timeline `plotW` wide covering `totalMin` minutes. Every block is at least 2px so a brief waking still shows. */
export function layout(segments: Segment[], totalMin: number, plotW: number): Block[] {
  const total = Math.max(1, totalMin);
  return segments.map(([at, dur, code]) => {
    const x = Math.max(0, Math.min(plotW - 2, (at / total) * plotW));
    const w = Math.max(2, Math.min(plotW - x, (dur / total) * plotW));
    return { x, w, lane: LANES.indexOf(code), code, at, dur };
  });
}

/** Minutes in each stage. */
export function totals(segments: Segment[]): Record<StageCode, number> {
  const t: Record<StageCode, number> = { d: 0, l: 0, r: 0, a: 0 };
  for (const [, dur, code] of segments) t[code] += dur;
  return t;
}
