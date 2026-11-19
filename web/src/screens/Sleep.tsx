import { useMemo } from 'react';
import { Banner, Card, Spinner } from '../components/ui';
import { MetricCard } from '../components/MetricCard';
import { Hypnogram } from '../components/Hypnogram';
import { parseSegments } from '../lib/hypnogram';
import { useDaily, useLatest, useRange, useRecords, useUnits } from '../lib/data';
import { dateLabel, hm, lastDays, localDate, sinceIso, timeLabel } from '../lib/metrics';

const STAGES = [
  { key: 'deep', label: 'Deep', color: 'blue' },
  { key: 'light', label: 'Light', color: 'orange' },
  { key: 'rem', label: 'REM', color: 'aqua' },
  { key: 'awake', label: 'Awake', color: 'yellow' },
] as const;

function Stack({ stages }: { stages: Record<string, number> }) {
  const parts = STAGES.map((s) => ({ ...s, min: stages[s.key] ?? 0 })).filter((p) => p.min > 0);
  const total = parts.reduce((a, p) => a + p.min, 0);
  if (!total) return null;
  return (
    <div className="stack" role="img" aria-label={parts.map((p) => `${p.label} ${hm(p.min)}`).join(', ')}>
      {parts.map((p) => (
        <span key={p.key} title={`${p.label} ${hm(p.min)}`} style={{ flex: p.min / total, background: `var(--c-${p.color})` }} />
      ))}
    </div>
  );
}

export function Sleep() {
  const units = useUnits();
  const range = useRange();
  const days = useMemo(() => lastDays(range), [range]);
  const latest = useLatest();
  const daily = useDaily(['sleep'], range);
  const since = sinceIso(Math.min(range, 60));
  const recs = useRecords('sleep', since, 120);

  if (!latest.data && !latest.error) return <div className="center"><Spinner /></div>;
  if (latest.data && !latest.data.sleep) return <p className="muted pad">No sleep data yet. It appears after your phone's first sync.</p>;

  const nights = (recs.data ?? []).filter((r) => r.extra?.stages);
  return (
    <>
      {daily.stale && <Banner>Can't reach the server. Showing what this device saved earlier.</Banner>}
      <div className="grid">
        <MetricCard metric="sleep" data={daily.data?.sleep} days={days} units={units} loading={daily.loading} note="Time asleep, counted on the day you wake up. Awake time in the night isn't included." />
        <Card>
          <h2 className="md-typescale-title-medium">Nights</h2>
          <ul className="legend">
            {STAGES.map((s) => (
              <li key={s.key}><span className="key-box" style={{ background: `var(--c-${s.color})` }} />{s.label}</li>
            ))}
          </ul>
          {!nights.length && <p className="muted">Sleep stages aren't available for these nights.</p>}
          <ul className="list nights">
            {(recs.data ?? []).slice(0, 21).map((r) => (
              <li key={r.start + r.source}>
                <div className="night-head">
                  <strong>{dateLabel(localDate(new Date(r.end)), { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                  <strong>{hm(r.value ?? 0)}</strong>
                </div>
                <span className="muted small">{timeLabel(r.start)} – {timeLabel(r.end)}</span>
                {(() => {
                  const segs = parseSegments(r.extra?.segments);
                  // Nights synced by an older version only have stage totals, so they keep the simple proportional bar.
                  return segs.length ? <Hypnogram start={r.start} end={r.end} segments={segs} /> : r.extra?.stages ? <Stack stages={r.extra.stages} /> : null;
                })()}
                {r.extra?.stages && (
                  <p className="stage-times">
                    {STAGES.map((st) => (
                      <span key={st.key}>
                        <span className="key-box" style={{ background: `var(--c-${st.color})` }} />
                        {st.label} {hm(r.extra!.stages[st.key] ?? 0)}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
