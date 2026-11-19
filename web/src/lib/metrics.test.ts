import { describe, expect, it } from 'vitest';
import { METRICS, SCALES, scaleColor, scaleLabel, scaleLegend } from './metrics';

const sleep = SCALES.sleep;
const min = (h: number) => h * 60;

describe('value scales', () => {
  it('sleep goes red, amber, green, then blue when it is a lot', () => {
    expect(scaleColor(sleep, min(4))).toBe('var(--s-critical)'); // below the first stop stays red
    expect(scaleColor(sleep, min(6))).toBe('var(--s-warning)');
    expect(scaleColor(sleep, min(7.5))).toBe('var(--s-good)'); // the whole healthy range is one solid green
    expect(scaleColor(sleep, min(9))).toBe('var(--s-good)');
    expect(scaleColor(sleep, min(10))).toBe('var(--c-blue)');
    expect(scaleColor(sleep, min(12))).toBe('var(--c-blue)'); // and stays blue
  });

  it('blends between stops instead of jumping', () => {
    expect(scaleColor(sleep, min(6.5))).toBe('color-mix(in oklab, var(--s-warning) 50%, var(--s-good))');
    expect(scaleColor(sleep, min(9.5))).toBe('color-mix(in oklab, var(--s-good) 50%, var(--c-blue))');
  });

  it('gives every value a word, so colour is never the only signal', () => {
    expect(scaleLabel(sleep, min(4))).toBe('Too little');
    expect(scaleLabel(sleep, min(5.9))).toBe('A bit short');
    expect(scaleLabel(sleep, min(8))).toBe('Healthy');
    expect(scaleLabel(sleep, min(11))).toBe('Long');
  });

  it('different metrics mean different things: 8,000 steps is green, 8 hours of exercise is blue', () => {
    expect(scaleColor(SCALES.steps, 8000)).toBe('var(--s-good)');
    expect(scaleColor(SCALES.exercise, 480)).toBe('var(--c-blue)');
  });

  it('resting heart rate runs the other way: low is blue-green, high is red', () => {
    const rhr = SCALES.resting_heart_rate;
    expect(scaleColor(rhr, 60)).toBe('var(--s-good)');
    expect(scaleColor(rhr, 110)).toBe('var(--s-critical)');
    expect(scaleColor(rhr, 35)).toBe('var(--c-blue)');
    expect(scaleLabel(rhr, 95)).toBe('High');
  });

  it('the legend lists each zone once, with its range', () => {
    expect(scaleLegend(METRICS.sleep, sleep, 'metric')).toEqual([
      { color: 'var(--s-critical)', label: 'Too little', range: 'up to 5h' },
      { color: 'var(--s-warning)', label: 'A bit short', range: 'about 6h' },
      { color: 'var(--s-good)', label: 'Healthy', range: '7h to 9h' },
      { color: 'var(--c-blue)', label: 'Long', range: '10h and over' },
    ]);
  });

  it('every scale is in ascending order, which the colour lookup relies on', () => {
    for (const [name, stops] of Object.entries(SCALES)) {
      expect(stops.every((s, i) => i === 0 || s.at > stops[i - 1].at), name).toBe(true);
      expect(Object.keys(METRICS)).toContain(name);
    }
  });
});
