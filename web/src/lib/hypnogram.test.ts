import { describe, expect, it } from 'vitest';
import { LANES, layout, parseSegments, totals, type Segment } from './hypnogram';

const night: Segment[] = [
  [0, 20, 'l'],
  [20, 40, 'd'],
  [60, 30, 'l'],
  [90, 10, 'a'],
  [100, 20, 'r'],
];

describe('hypnogram layout', () => {
  it('places each segment at its own time, in proportion', () => {
    const b = layout(night, 120, 600); // 5px per minute
    expect(b.map((x) => [x.x, x.w])).toEqual([[0, 100], [100, 200], [300, 150], [450, 50], [500, 100]]);
  });

  it('puts awake on top and deep at the bottom', () => {
    expect(LANES).toEqual(['a', 'r', 'l', 'd']);
    const b = layout(night, 120, 600);
    expect(b[3].lane).toBe(0); // awake
    expect(b[1].lane).toBe(3); // deep
  });

  it('never makes a block thinner than 2px, and keeps everything inside the plot', () => {
    const b = layout([[0, 1, 'a'], [599, 5, 'l']], 600, 300); // half a pixel a minute
    expect(b[0].w).toBe(2);
    expect(b[1].x + b[1].w).toBeLessThanOrEqual(300);
  });

  it('adds the stages up', () => {
    expect(totals(night)).toEqual({ d: 40, l: 50, r: 20, a: 10 });
  });

  it('ignores damaged or older records and sorts by time', () => {
    expect(parseSegments(undefined)).toEqual([]);
    expect(parseSegments([[5, 10, 'x'], [1, 0, 'd'], 'junk', [30, 10, 'r'], [0, 10, 'l']])).toEqual([[0, 10, 'l'], [30, 10, 'r']]);
  });
});
