import { registerPlugin } from '@capacitor/core';
import { isNative } from './api';
import { METRICS, METRIC_ICONS, SCALES, type Color, type Units } from './metrics';

/** How a widget on the home screen was set up. */
export interface WidgetConfig {
  metric: string;
  /** "both" = number and chart, "number", or "chart" */
  style: 'both' | 'number' | 'chart';
  kind: 'bar' | 'line';
  days: number;
  /** Colour by value, where the metric has a scale. */
  rated: boolean;
}

interface WidgetsPlugin {
  setCatalog(o: { json: string }): Promise<void>;
  /** Set (with the widget's id) when the launcher opened this screen to set up or change a widget. */
  pendingConfigure(): Promise<{ id?: number; config?: WidgetConfig }>;
  finishConfigure(o: { id: number; config: WidgetConfig }): Promise<void>;
  cancelConfigure(): Promise<void>;
  refresh(): Promise<void>;
  takeRoute(): Promise<{ route?: string }>;
  count(): Promise<{ count: number }>;
}

export const widgets = isNative ? registerPlugin<WidgetsPlugin>('HcWidgets') : null;

/** The series colours as light/dark hex (web/src/styles.css `--c-*`, which these must match): the widget can't read CSS. */
const PALETTE: Record<Color, { light: string; dark: string }> = {
  blue: { light: '#2a78d6', dark: '#3987e5' },
  orange: { light: '#eb6834', dark: '#d95926' },
  aqua: { light: '#1baf7a', dark: '#199e70' },
  yellow: { light: '#eda100', dark: '#c98500' },
  magenta: { light: '#e87ba4', dark: '#d55181' },
  green: { light: '#008300', dark: '#0ca30c' },
  violet: { light: '#6250d6', dark: '#9085e9' },
  red: { light: '#e34948', dark: '#e66767' },
};

/** The value-scale tones (the status colours, never themed, plus the series blue), as in styles.css. */
const TONES = {
  red: { light: '#d03b3b', dark: '#d03b3b' },
  amber: { light: '#fab219', dark: '#fab219' },
  green: { light: '#0ca30c', dark: '#0ca30c' },
  blue: PALETTE.blue,
};

/** Which screen of the app a tapped widget opens: the tab that has the metric (App.tsx). */
const TAB: Record<string, string> = {
  sleep: 'sleep',
  steps: 'activity', distance: 'activity', active_calories: 'activity', total_calories: 'activity', exercise: 'activity',
  heart_rate: 'vitals', resting_heart_rate: 'vitals', hrv: 'vitals', oxygen_saturation: 'vitals', blood_pressure: 'vitals',
  respiratory_rate: 'vitals', body_temperature: 'vitals', blood_glucose: 'vitals',
  weight: 'body', body_fat: 'body', height: 'body', hydration: 'body', nutrition: 'body',
};

/** Metrics a widget can show. Blood pressure has two numbers a reading, which a single-number widget can't do. */
export const WIDGET_METRICS = Object.values(METRICS).filter((m) => m.key !== 'blood_pressure');

/**
 * Everything a widget needs to draw a metric the way the app does. Every conversion in METRICS is a straight line
 * (value * a + b), so that is what is sent; the widget never needs to know the rules, only the numbers.
 */
export function buildCatalog(units: Units) {
  const metrics = Object.fromEntries(
    WIDGET_METRICS.map((m) => {
      const b = m.conv(0, units);
      return [
        m.key,
        {
          label: m.label,
          kind: m.kind,
          duration: !!m.duration,
          a: m.conv(1, units) - b,
          b,
          digits: m.digits,
          unit: m.unit(units),
          colorLight: PALETTE[m.color].light,
          colorDark: PALETTE[m.color].dark,
          icon: METRIC_ICONS[m.key],
          tab: TAB[m.key] ?? 'overview',
          byEnd: m.key === 'sleep',
          stops: SCALES[m.key] ?? null,
        },
      ];
    }),
  );
  return { metrics, tones: TONES };
}

/** Hand the widgets the app's metric definitions. Cheap; done at start and when units change. */
export async function pushCatalog(units: Units) {
  try {
    await widgets?.setCatalog({ json: JSON.stringify(buildCatalog(units)) });
  } catch {
    /* an older build of the native side */
  }
}

export const refreshWidgets = () => widgets?.refresh().catch(() => {});
