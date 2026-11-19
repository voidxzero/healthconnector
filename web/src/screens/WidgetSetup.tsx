import { useEffect, useState } from 'react';
import { Banner, Card } from '../components/ui';
import { health } from '../lib/health';
import { haptics } from '../lib/haptics';
import { SCALES } from '../lib/metrics';
import { WIDGET_METRICS, widgets, type WidgetConfig } from '../lib/widgets';

const STYLES: { id: WidgetConfig['style']; label: string }[] = [
  { id: 'both', label: 'Number and chart' },
  { id: 'number', label: 'Number only' },
  { id: 'chart', label: 'Chart only' },
];
const DAYS = [7, 14, 30];

/**
 * Setting up one widget: opened by the launcher when a widget is added (or changed), in place of the app.
 * Nothing here needs an account or a server; the widget reads Health Connect itself.
 */
export function WidgetSetup({ id, initial }: { id: number; initial?: WidgetConfig }) {
  const [cfg, setCfg] = useState<WidgetConfig>(initial ?? { metric: 'sleep', style: 'both', kind: 'bar', days: 7, rated: true });
  const [needsAccess, setNeedsAccess] = useState(false);
  const set = (patch: Partial<WidgetConfig>) => setCfg((c) => ({ ...c, ...patch }));

  useEffect(() => {
    health?.status().then((s) => setNeedsAccess(s.sdk === 'available' && s.missing === s.total)).catch(() => {});
  }, []);

  const hasScale = !!SCALES[cfg.metric];
  const finish = async () => {
    haptics.done();
    await widgets?.finishConfigure({ id, config: cfg });
  };

  return (
    <main className="login">
      <Card className="login-card">
        <h1 className="md-typescale-title-large">{initial ? 'Change widget' : 'Add a widget'}</h1>
        <p className="muted">Pick what this widget shows. You can add as many as you like, each different.</p>

        {needsAccess && (
          <Banner icon="warn">
            The widget reads Health Connect, which hasn't been allowed yet.{' '}
            <button className="link" onClick={() => health?.requestAccess().then(() => setNeedsAccess(false)).catch(() => {})}>Allow access</button>
          </Banner>
        )}

        <md-outlined-select label="Show" class="field" value={cfg.metric} onChange={(e: any) => { haptics.step(); set({ metric: e.target.value }); }}>
          {WIDGET_METRICS.map((m) => (
            <md-select-option key={m.key} value={m.key}>
              <div slot="headline">{m.label}</div>
            </md-select-option>
          ))}
        </md-outlined-select>

        <md-outlined-select label="Layout" class="field" value={cfg.style} onChange={(e: any) => { haptics.step(); set({ style: e.target.value }); }}>
          {STYLES.map((s) => (
            <md-select-option key={s.id} value={s.id}>
              <div slot="headline">{s.label}</div>
            </md-select-option>
          ))}
        </md-outlined-select>

        {cfg.style !== 'number' && (
          <>
            <div>
              <p className="muted small">Chart</p>
              <div className="rangebar" role="group" aria-label="Chart type">
                {(['bar', 'line'] as const).map((k) => (
                  <button key={k} className={'seg' + (k === cfg.kind ? ' on' : '')} aria-pressed={k === cfg.kind} onClick={() => { haptics.step(); set({ kind: k }); }}>
                    {k === cfg.kind ? '✓ ' : ''}{k === 'bar' ? 'Bars' : 'Line'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="muted small">Covers</p>
              <div className="rangebar" role="group" aria-label="Days shown">
                {DAYS.map((d) => (
                  <button key={d} className={'seg' + (d === cfg.days ? ' on' : '')} aria-pressed={d === cfg.days} onClick={() => { haptics.step(); set({ days: d }); }}>
                    {d === cfg.days ? '✓ ' : ''}{d} days
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {hasScale && (
          <ul className="list rules">
            <li>
              <label id="wsetup-rated">Colour by value</label>
              <md-switch aria-labelledby="wsetup-rated" selected={cfg.rated} onChange={(e: any) => { haptics.toggle(e.target.selected); set({ rated: e.target.selected }); }} />
            </li>
          </ul>
        )}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <md-text-button onClick={() => widgets?.cancelConfigure()}>Cancel</md-text-button>
          <md-filled-button onClick={finish}>{initial ? 'Save' : 'Add widget'}</md-filled-button>
        </div>
      </Card>
    </main>
  );
}
