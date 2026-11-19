import { Icon } from '../components/icons';
import { Banner, Card, Empty, Spinner } from '../components/ui';
import { Spark } from '../components/Spark';
import { isLocal, isNative } from '../lib/api';
import { useEffect, useState } from 'react';
import { health } from '../lib/health';
import { localError, refreshAfterAccess } from '../lib/localsync';
import { useDaily, useLatest, useUnits } from '../lib/data';
import { METRICS, METRIC_ICONS, dateLabel, fmt, lastDays, localDate, num, type Day } from '../lib/metrics';

const TILES = ['sleep', 'steps', 'active_calories', 'exercise', 'resting_heart_rate', 'heart_rate', 'hrv', 'oxygen_saturation', 'weight', 'body_fat'];

function when(key: string, date: string): string {
  const today = localDate();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === 'sleep') return date === today || date === localDate(y) ? 'Last night' : dateLabel(date);
  return date === today ? 'Today' : dateLabel(date);
}

function delta(rows: Day[]): string | null {
  if (rows.length < 3) return null;
  const last = rows[rows.length - 1];
  const prev = rows.slice(-8, -1);
  const avg = prev.reduce((a, r) => a + r.value, 0) / prev.length;
  if (!avg) return null;
  const pct = Math.round(((last.value - avg) / avg) * 100);
  return pct === 0 ? 'Same as the prior week' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs prior ${prev.length} days`;
}

export function Overview({ onGo }: { onGo: (tab: string) => void }) {
  const units = useUnits();
  const days = lastDays(14);
  const daily = useDaily(TILES, 14);
  const latest = useLatest();
  const bp = latest.data?.blood_pressure;
  // Access already given but nothing to show: then "Allow access" is the wrong advice.
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    health?.status().then((s) => setAllowed(s.sdk === 'available' && s.missing === 0)).catch(() => {});
  }, []);

  if (!daily.data && !daily.error) return <div className="center"><Spinner /></div>;
  const data = daily.data ?? {};
  const have = TILES.filter((k) => data[k]?.length);

  return (
    <>
      {daily.stale && <Banner>Can't reach the server. Showing what this device saved earlier.</Banner>}
      {daily.error && !daily.data && <Banner tone="error" icon="warn">{daily.error}</Banner>}
      {!have.length && !bp && !daily.error && (
        <Empty title="No health data yet">
          {isLocal() && allowed
            ? "Health Connect is allowed, but it has nothing for this app to show yet. This app reads what other apps (a watch, Fitbit, Samsung Health…) put into Health Connect."
            : isLocal()
            ? 'Allow access to Health Connect and your data appears here.'
            : isNative
              ? 'Open Settings, allow Health Connect access, then tap Sync now.'
              : 'Sign in on the Android app and it will start sending your Health Connect data here.'}
          {isLocal() && localError() && <><br /><span className="error">Couldn't read some data: {localError()}</span></>}
          <br />
          {isLocal() && allowed ? (
            <md-filled-tonal-button onClick={() => onGo('settings')} class="mt">See what Health Connect has</md-filled-tonal-button>
          ) : isLocal() ? (
            <md-filled-button class="mt" onClick={() => health?.requestAccess().then(() => refreshAfterAccess()).catch(() => {})}>Allow access</md-filled-button>
          ) : (
            <md-filled-tonal-button onClick={() => onGo('settings')} class="mt">Go to Settings</md-filled-tonal-button>
          )}
        </Empty>
      )}
      <div className={'tiles' + (daily.loading ? ' loading' : '')}>
        {have.map((k) => {
          const m = METRICS[k];
          const rows = data[k];
          const last = rows[rows.length - 1];
          const d = m.kind === 'sum' ? delta(rows) : null;
          return (
            <Card key={k} className="tile">
              <p className="tile-label">
                <span className="tile-icon" style={{ '--tone': `var(--c-${m.color})` } as React.CSSProperties}>
                  <Icon name={METRIC_ICONS[k]} size={18} />
                </span>
                {m.label}
              </p>
              <p className="tile-value">{fmt(m, last.value, units)}{!m.duration && <span className="unit"> {m.unit(units)}</span>}</p>
              <p className="muted small">{when(k, last.date)}{d ? ` · ${d}` : ''}</p>
              <Spark days={days} data={rows} color={`var(--c-${m.color})`} />
            </Card>
          );
        })}
        {bp && (
          <Card className="tile">
            <p className="tile-label">
              <span className="tile-icon" style={{ '--tone': `var(--c-${METRICS.blood_pressure.color})` } as React.CSSProperties}>
                <Icon name={METRIC_ICONS.blood_pressure} size={18} />
              </span>
              Blood pressure
            </p>
            <p className="tile-value">{num(bp.value, 0)}/{num(bp.extra?.diastolic ?? 0, 0)} <span className="unit">mmHg</span></p>
            <p className="muted small">{dateLabel(bp.start.slice(0, 10))}</p>
          </Card>
        )}
      </div>
    </>
  );
}
