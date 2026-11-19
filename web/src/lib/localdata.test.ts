import { describe, expect, it } from 'vitest';
import { daily, latestOf, recordsOf, utc, type LocalRec } from './localdata';

const r = (type: string, start: string, value: number | null, o: Partial<LocalRec> = {}): LocalRec => ({
  type, start, end: o.end ?? start, source: o.source ?? 'a', value, extra: o.extra ?? null,
});
// "now" is the evening of 18 Nov 2026 in UTC.
const NOW = Date.parse('2026-11-18T20:00:00Z');

describe('daily', () => {
  it('sums a day and takes the larger source rather than adding phone and watch', () => {
    const recs = [
      r('steps', '2026-11-17T10:00:00Z', 1000, { source: 'watch' }),
      r('steps', '2026-11-17T12:00:00Z', 500, { source: 'watch' }),
      r('steps', '2026-11-17T10:00:00Z', 900, { source: 'phone' }),
    ];
    expect(daily(recs, ['steps'], 5, 0, NOW).steps).toEqual([{ date: '2026-11-17', value: 1500, count: 3 }]);
  });

  it('averages the other types and reports the range', () => {
    const recs = [r('heart_rate', '2026-11-17T10:00:00Z', 60), r('heart_rate', '2026-11-17T10:05:00Z', 80)];
    expect(daily(recs, ['heart_rate'], 5, 0, NOW).heart_rate).toEqual([{ date: '2026-11-17', value: 70, min: 60, max: 80, count: 2 }]);
  });

  it('puts sleep on the day it ends, in the viewer\'s time zone', () => {
    const sleep = r('sleep', '2026-11-17T22:30:00Z', 450, { end: '2026-11-18T06:30:00Z' });
    expect(daily([sleep], ['sleep'], 3, 0, NOW).sleep[0].date).toBe('2026-11-18');
    // five hours behind UTC, it ended at 01:30 on the 18th; eight hours ahead it ended at 14:30 on the 18th
    expect(daily([sleep], ['sleep'], 3, -300, NOW).sleep[0].date).toBe('2026-11-18');
    expect(daily([sleep], ['sleep'], 3, 480, NOW).sleep[0].date).toBe('2026-11-18');
  });

  it('groups by local day, so late evening UTC can be tomorrow', () => {
    const steps = r('steps', '2026-11-17T23:30:00Z', 100);
    expect(daily([steps], ['steps'], 5, 120, NOW).steps[0].date).toBe('2026-11-18'); // UTC+2
    expect(daily([steps], ['steps'], 5, -300, NOW).steps[0].date).toBe('2026-11-17');
  });

  it('leaves out days before the range and ignores unknown types', () => {
    const recs = [r('steps', '2026-11-10T10:00:00Z', 5), r('steps', '2026-11-18T10:00:00Z', 7), r('bogus', '2026-11-18T10:00:00Z', 1)];
    const out = daily(recs, ['steps', 'bogus'], 3, 0, NOW);
    expect(out.steps.map((d) => d.date)).toEqual(['2026-11-18']);
    expect(out.bogus).toBeUndefined();
  });

  it('keeps days sorted', () => {
    const recs = [r('steps', '2026-11-18T10:00:00Z', 1), r('steps', '2026-11-16T10:00:00Z', 1), r('steps', '2026-11-17T10:00:00Z', 1)];
    expect(daily(recs, ['steps'], 7, 0, NOW).steps.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
  });
});

describe('records and latest', () => {
  const recs = [r('weight', '2026-11-10T07:00:00Z', 80), r('weight', '2026-11-17T07:00:00Z', 79.5), r('steps', '2026-11-17T07:00:00Z', 5)];
  it('lists newest first, filtered by type and since', () => {
    expect(recordsOf(recs, 'weight', '2026-11-12T00:00:00Z', 10).map((x) => x.value)).toEqual([79.5]);
    expect(recordsOf(recs, 'weight', '', 10).map((x) => x.value)).toEqual([79.5, 80]);
    expect(recordsOf(recs, 'weight', '', 1)).toHaveLength(1);
  });
  it('gives the most recent record per type', () => {
    const l = latestOf(recs);
    expect(l.weight.value).toBe(79.5);
    expect(l.steps.unit).toBe('count');
    expect(Object.keys(l).sort()).toEqual(['steps', 'weight']);
  });
});

describe('utc', () => {
  it('normalises offsets and drops fractions, like the server', () => {
    expect(utc('2026-11-17T22:30:00.123+02:00')).toBe('2026-11-17T20:30:00Z');
    expect(utc('2026-11-17T20:30:00Z')).toBe('2026-11-17T20:30:00Z');
  });
});
