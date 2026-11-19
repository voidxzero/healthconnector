import { useState } from 'react';
import { METRICS, SCALES, dateLabel, fmt, num, scaleColor, scaleLabel, scaleLegend, withUnit, type Day, type Units } from '../lib/metrics';
import { Chart, Legend, type Series } from './Chart';
import { useChartKind, useRated } from '../lib/data';
import { haptics } from '../lib/haptics';
import { Icon } from './icons';
import { Card, KindToggle } from './ui';

/** One metric: a headline figure, a chart, and a table view of the same numbers. */
export function MetricCard({
  metric, data, days, units, loading, note,
}: { metric: string; data: Day[] | undefined; days: string[]; units: Units; loading: boolean; note?: string }) {
  const m = METRICS[metric];
  const [table, setTable] = useState(false);
  const rows = data ?? [];
  const [kind, toggleKind] = useChartKind(metric, m.kind === 'sum' ? 'bar' : 'line');
  const toDisplay = (v: number) => m.conv(v, units);
  const stops = SCALES[metric];
  const [ratedOn, toggleRated] = useRated(metric);
  const rating = stops && ratedOn ? { color: (v: number) => scaleColor(stops, v), label: (v: number) => scaleLabel(stops, v), stops: stops.map((st) => ({ at: st.at, color: scaleColor(stops, st.at) })) } : undefined;
  const series: Series[] = [{ key: m.key, label: m.label, color: m.color, points: rows }];

  const avg = rows.length ? rows.reduce((a, r) => a + r.value, 0) / rows.length : 0;
  const last = rows[rows.length - 1];
  const headline = !rows.length
    ? null
    : m.kind === 'sum'
      ? { big: withUnit(m, avg, units), small: 'daily average' }
      : { big: withUnit(m, last.value, units), small: `latest · ${dateLabel(last.date)}` };

  return (
    <Card className={loading ? 'loading' : ''}>
      <div className="card-head">
        <div>
          <h2 className="md-typescale-title-medium">{m.label}</h2>
          {headline ? (
            <p className="headline">
              <span className="big">{headline.big}</span> <span className="muted">{headline.small}</span>
            </p>
          ) : (
            <p className="muted">No data in this range</p>
          )}
        </div>
        {rows.length > 0 && (
          <div className="card-actions">
            {!table && stops && (
              <button className="icon-btn" onClick={() => { haptics.step(); toggleRated(); }} aria-pressed={ratedOn} title={ratedOn ? 'Stop colouring by value' : 'Colour by value'}>
                <Icon name="palette" />
                <span className="sr">{ratedOn ? 'Stop colouring by value' : 'Colour by value'}</span>
              </button>
            )}
            {!table && <KindToggle kind={kind} onToggle={toggleKind} />}
          <button className="icon-btn" onClick={() => { haptics.step(); setTable(!table); }} aria-pressed={table} title={table ? 'Show chart' : 'Show table'}>
            <Icon name={table ? 'chart' : 'table'} />
            <span className="sr">{table ? 'Show chart' : 'Show table'}</span>
          </button>
          </div>
        )}
      </div>
      {note && <p className="muted small">{note}</p>}
      {rows.length > 0 &&
        (table ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th className="num">{m.kind === 'sum' ? 'Total' : 'Average'}</th>{stops && <th>Zone</th>}{m.kind === 'avg' && <th className="num">Range</th>}</tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.date}>
                    <td>{dateLabel(r.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td className="num">{withUnit(m, r.value, units)}</td>
                    {stops && <td className="muted">{scaleLabel(stops, r.value)}</td>}
                    {m.kind === 'avg' && (
                      <td className="num muted">{r.min !== undefined && r.max !== undefined && r.max !== r.min ? `${fmt(m, r.min, units)}–${fmt(m, r.max, units)}` : ''}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <Chart
              series={series}
              days={days}
              kind={kind}
              zero={m.floorZero}
              rating={rating}
              toDisplay={toDisplay}
              axisFmt={(v) => (m.duration ? `${num(v, 0)}h` : num(v, m.digits))}
              tipFmt={(v) => withUnit(m, v, units)}
              ariaLabel={`${m.label}, ${rows.length} days with data. Use the table view for exact values.`}
            />
            <Legend series={series} kind={kind} />
            {rating && stops && (
              <ul className="legend zones" aria-label="What the colours mean">
                {scaleLegend(m, stops, units).map((z) => (
                  <li key={z.label}>
                    <span className="key-box" style={{ background: z.color }} />
                    {z.label} <span className="muted">{z.range}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ))}
    </Card>
  );
}
