// Little vibrations: a tick when you move between screens or change a setting, a click on a switch, a soft
// double tap when a sync worked and two firm knocks when it didn't, a detent for each day as you drag across a chart.
// On Android they come from HapticsPlugin (web/android/app/src/main/java/app/healthconnector/HapticsPlugin.java),
// which plays crisp haptic "primitives" where the phone has them and a plain waveform where it doesn't. In a
// browser, navigator.vibrate does what it can (usually nothing on a desktop). Can be switched off in Settings.

import { Capacitor, registerPlugin } from '@capacitor/core';

type Primitive = 'click' | 'tick' | 'lowTick' | 'thud';

interface Step {
  p: Primitive;
  /** Strength, 0–1. */
  s: number;
  /** Pause before this step, in ms, counted from the end of the one before. */
  d?: number;
}

/** One vibration: primitives for phones that have them, and a waveform (ms off, ms on, … with strengths 0–255) for the rest. */
export interface Pattern {
  steps: Step[];
  timings: number[];
  amplitudes: number[];
}

const Native = registerPlugin<{ play(pattern: Pattern): Promise<void> }>('HcHaptics');
const KEY = 'hc.haptics';

/** True where there's something to feel: the Android app, or a browser that can vibrate. */
export const hapticsAvailable = () =>
  Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function');

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Builds the waveform from [off, on, strength] pulses. */
function pulses(...list: [off: number, on: number, strength: number][]): Pick<Pattern, 'timings' | 'amplitudes'> {
  const timings: number[] = [];
  const amplitudes: number[] = [];
  for (const [off, on, strength] of list) {
    timings.push(off, on);
    amplitudes.push(0, Math.round(strength * 255));
  }
  return { timings, amplitudes };
}

let lastAt = 0;

function play(pattern: Pattern, { light = false } = {}) {
  if (!hapticsEnabled()) return;
  // Light ticks (chart scrubbing, quick taps) never pile up into a hum.
  const now = Date.now();
  if (light && now - lastAt < 35) return;
  lastAt = now;
  if (Capacitor.isNativePlatform()) {
    void Native.play(pattern).catch(() => {});
    return;
  }
  try {
    // The Vibration API's pattern starts with a buzz and has no strengths.
    navigator.vibrate?.([0, ...pattern.timings]);
  } catch {
    // Not available: nothing to feel.
  }
}

/** The faintest tick. `strength` 0–1. */
function tick(strength: number): Pattern {
  const s = Math.max(0.15, Math.min(1, strength));
  return { steps: [{ p: 'tick', s }], ...pulses([0, 6 + Math.round(s * 6), s * 0.6]) };
}

const patterns = {
  /** A soft double tap: synced. */
  synced: { steps: [{ p: 'tick', s: 0.6 }, { p: 'click', s: 0.5, d: 70 }], ...pulses([0, 10, 0.4], [80, 12, 0.5]) },
  /** Two firm knocks: that didn't work. */
  failed: { steps: [{ p: 'thud', s: 0.9 }, { p: 'thud', s: 0.9, d: 90 }], ...pulses([0, 40, 0.8], [90, 40, 0.8]) },
  /** A switch turned on: a crisp click. */
  on: { steps: [{ p: 'click', s: 0.7 }], ...pulses([0, 14, 0.7]) },
  /** A switch turned off: a lower, softer tock. */
  off: { steps: [{ p: 'lowTick', s: 0.7 }], ...pulses([0, 16, 0.4]) },
  /** Something saved or confirmed. */
  done: { steps: [{ p: 'click', s: 0.8 }], ...pulses([0, 16, 0.8]) },
} satisfies Record<string, Pattern>;

export const haptics = {
  synced: () => play(patterns.synced),
  failed: () => play(patterns.failed),
  /** Moving to another screen, or picking an option (range, units, bar/line). */
  step: () => play(tick(0.35), { light: true }),
  /** A pull reaching far enough to let go, or a finger passing from one day to the next on a chart. */
  detent: (fraction = 0.5) => play(tick(0.3 + fraction * 0.5), { light: true }),
  /** A switch flipping. */
  toggle: (on: boolean) => play(on ? patterns.on : patterns.off),
  /** A dialog's action went through. */
  done: () => play(patterns.done),
};
