import { useMemo } from 'react';
import { Banner, Spinner } from '../components/ui';
import { MetricCard } from '../components/MetricCard';
import { Chart, Legend, type Series } from '../components/Chart';
import { Card, KindToggle } from '../components/ui';
import { useChartKind, useDaily, useLatest, useRange, useRecords, useUnits } from '../lib/data';
import { dateLabel, exerciseName, hm, lastDays, localDate, num, sinceIso, type Day } from '../lib/metrics';
import { useState } from 'react';
import { Icon } from '../components/icons';
import { haptics } from '../lib/haptics';

/** Blood pressure has two numbers per reading, so it's built from the readings themselves. */
function BloodPressureCard({ days, range }: { days: string[]; range: number }) {
  const since = sinceIso(range);
  const recs = useRecords('blood_pressure', since, 2000);
  const [table, setTable] = useState(false);
  const [kind, toggleKind] = useChartKind('blood_pressure', 'line');
  const series = useMemo<Series[]>(() => {
    const sys = new Map<string, number[]>(), dia = new Map<string, number[]>();
    (recs.data ?? []).forEach((r) => {
      const d = localDate(new Date(r.start));
      if (r.value != null) sys.set(d, [...(sys.get(d) ?? []), r.value]);
      if (r.extra?.diastolic != null) dia.set(d, [...(dia.get(d) ?? []), r.extra.diastolic]);
    });
    const toDays = (m: Map<string, number[]>): Day[] =>
      [...m].map(([date, v]) => ({ date, value: v.reduce((a, b) => a + b, 0) / v.length, count: v.length })).sort((a, b) => a.date.localeCompare(b.date));
    return [
      { key: 'sys', label: 'Systolic', color: 'blue', points: toDays(sys) },
      { key: 'dia', label: 'Diastolic', color: 'orange', points: toDays(dia) },
    ];
  }, [recs.data]);
  const has = series[0].points.length > 0;
  const last = series[0].points[series[0].points.length - 1];
  const lastD = series[1].points[series[1].points.length - 1];
  return (
    <Card className={recs.loading ? 'loading' : ''}>
      <div className="card-head">
        <div>
          <h2 className="md-typescale-title-medium">Blood pressure</h2>
          {has ? <p className="headline"><span className="big">{num(last.value, 0)}/{num(lastD?.value ?? 0, 0)} mmHg</span> <span className="muted">latest · {dateLabel(last.date)}</span></p> : <p className="muted">No data in this range</p>}
        </div>
        {has && (
          <div className="card-actions">
            {!table && <KindToggle kind={kind} onToggle={toggleKind} />}
            <button className="icon-btn" onClick={() => { haptics.step(); setTable(!table); }} aria-pressed={table} title={table ? 'Show chart' : 'Show table'}><Icon name={table ? 'chart' : 'table'} /><span className="sr">{table ? 'Show chart' : 'Show table'}</span></button>
          </div>
        )}
      </div>
      {has && (table ? (
        <div className="table-wrap"><table><thead><tr><th>Date</th><th className="num">Systolic</th><th className="num">Diastolic</th></tr></thead><tbody>
          {[...series[0].points].reverse().map((p) => <tr key={p.date}><td>{dateLabel(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td className="num">{num(p.value, 0)}</td><td className="num">{num(series[1].points.find((q) => q.date === p.date)?.value ?? 0, 0)}</td></tr>)}
        </tbody></table></div>
      ) : (
        <>
          <Chart series={series} days={days} kind={kind} toDisplay={(v) => v} axisFmt={(v) => num(v, 0)} tipFmt={(v) => `${num(v, 0)} mmHg`} ariaLabel="Blood pressure, systolic and diastolic. Use the table view for exact values." />
          <Legend series={series} kind={kind} />
        </>
      ))}
    </Card>
  );
}

function ExerciseList({ range }: { range: number }) {
  const since = sinceIso(range);
  const recs = useRecords('exercise', since, 100);
  const rows = recs.data ?? [];
  if (!rows.length) return null;
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Workouts</h2>
      <ul className="list">
        {rows.slice(0, 30).map((r) => (
          <li key={r.start + r.source}>
            <div>
              <strong>{r.extra?.title || exerciseName(r.extra?.type)}</strong>
              <span className="muted small"> {dateLabel(localDate(new Date(r.start)), { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </div>
            <span>{hm(r.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const NOTES: Record<string, string> = {
  steps: 'When a phone and a watch both count steps, each day uses whichever counted more.',
};

export function Metrics({ keys, extra }: { keys: string[]; extra?: 'bp' | 'exercise' }) {
  const units = useUnits();
  const range = useRange();
  const days = useMemo(() => lastDays(range), [range]);
  const latest = useLatest();
  const daily = useDaily(keys, range);

  if (!latest.data && !latest.error) return <div className="center"><Spinner /></div>;
  const present = keys.filter((k) => latest.data?.[k]);
  const showBp = extra === 'bp' && latest.data?.blood_pressure;

  return (
    <>
      {daily.stale && <Banner>Can't reach the server. Showing what this device saved earlier.</Banner>}
      {(daily.error || latest.error) && !daily.data && <Banner tone="error" icon="warn">{daily.error || latest.error}</Banner>}
      {!present.length && !showBp && latest.data && <p className="muted pad">Nothing here yet. This fills in once your phone has synced matching Health Connect data.</p>}
      <div className="grid">
        {present.map((k) => (
          <MetricCard key={k} metric={k} data={daily.data?.[k]} days={days} units={units} loading={daily.loading} note={NOTES[k]} />
        ))}
        {showBp && <BloodPressureCard days={days} range={range} />}
        {extra === 'exercise' && latest.data?.exercise && <ExerciseList range={range} />}
      </div>
    </>
  );
}
