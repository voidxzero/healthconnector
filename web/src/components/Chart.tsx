import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { haptics } from '../lib/haptics';
import { dateLabel, type Color, type Day } from '../lib/metrics';

/** Colours a graph by value: bars take the colour of their number, a line shades along its height. */
export interface Rating {
  /** CSS colour for a stored value. */
  color: (stored: number) => string;
  /** The zone's word for a stored value, shown in the tooltip. */
  label: (stored: number) => string;
  /** The stops (stored value, CSS colour) a line's gradient follows. */
  stops: { at: number; color: string }[];
}

export interface Series {
  key: string;
  label: string;
  color: Color;
  points: Day[];
}

interface Props {
  series: Series[];
  /** Every date on the x axis, oldest first (days with no data stay as gaps). */
  days: string[];
  kind: 'bar' | 'line';
  /** Stored value -> the number the axis is drawn in (hours, km, lb…). */
  toDisplay: (stored: number) => number;
  axisFmt: (display: number) => string;
  /** Stored value -> text for the tooltip and end label, with its unit. */
  tipFmt: (stored: number) => string;
  /** Start the axis at zero (bars always do). */
  zero?: boolean;
  /** Colour by value instead of one colour per series. */
  rating?: Rating;
  height?: number;
  ariaLabel: string;
}

const M = { top: 10, right: 14, bottom: 24, left: 44 };

function niceTicks(lo: number, hi: number, target = 4): number[] {
  if (!(hi > lo)) hi = lo + 1;
  // Of the round steps (1, 2, 5 × a power of ten), take the one giving the tick count nearest the target.
  const base = Math.pow(10, Math.floor(Math.log10((hi - lo) / target)));
  let step = base;
  let best = Infinity;
  for (const f of [0.5, 1, 2, 5, 10]) {
    const miss = Math.abs((hi - lo) / (base * f) - target);
    if (miss < best) {
      best = miss;
      step = base * f;
    }
  }
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}

/** A bar with a 4px rounded data end and a square baseline. */
function barPath(x: number, w: number, yTop: number, yBase: number): string {
  const h = Math.max(0, yBase - yTop);
  const r = Math.min(4, w / 2, h);
  return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
}

const cvar = (c: Color) => `var(--c-${c})`;

export function Legend({ series, kind }: { series: Series[]; kind: 'bar' | 'line' }) {
  if (series.length < 2) return null;
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={kind === 'bar' ? 'key-box' : 'key-line'} style={{ background: cvar(s.color) }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function Chart({ series, days, kind, toDisplay, axisFmt, tipFmt, zero, rating, height = 200, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const gradId = 'g' + id.replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    const index = new Map(days.map((d, i) => [d, i]));
    const byIdx = series.map((s) => {
      const m = new Map<number, Day>();
      s.points.forEach((p) => {
        const i = index.get(p.date);
        if (i !== undefined) m.set(i, p);
      });
      return m;
    });
    let lo = Infinity;
    let hi = -Infinity;
    byIdx.forEach((m) =>
      m.forEach((p) => {
        for (const v of [p.value, p.min, p.max]) {
          if (v === undefined || v === null) continue;
          const d = toDisplay(v);
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
      }),
    );
    if (!isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const fromZero = kind === 'bar' || zero;
    if (fromZero) lo = Math.min(0, lo);
    else {
      const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
      lo -= pad;
      hi += pad;
    }
    const ticks = niceTicks(lo, hi);
    // Lines span exactly the padded data range, so nothing is drawn below the plot; bars start at zero.
    const yMin = fromZero ? 0 : lo;
    const yMax = fromZero ? Math.max(ticks[ticks.length - 1], hi) : hi;
    return { byIdx, ticks, yMin, yMax };
  }, [series, days, kind, zero, toDisplay]);

  const W = width;
  const plotW = W - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const slot = plotW / Math.max(1, days.length);
  const x = (i: number) => M.left + (i + 0.5) * slot;
  const y = (v: number) => M.top + plotH - ((v - g.yMin) / (g.yMax - g.yMin || 1)) * plotH;

  const labelIdx = useMemo(() => {
    const n = days.length;
    const want = Math.max(2, Math.min(6, Math.floor(plotW / 70)));
    const out = new Set<number>();
    for (let k = 0; k < want; k++) out.add(Math.round(((n - 1) * k) / (want - 1)));
    return [...out];
  }, [days.length, plotW]);

  const withData = useMemo(() => {
    const s = new Set<number>();
    g.byIdx.forEach((m) => m.forEach((_, i) => s.add(i)));
    return [...s].sort((a, b) => a - b);
  }, [g.byIdx]);

  const lastIdx = useRef(-1);
  const move = (clientX: number, touch = false) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.max(0, Math.min(days.length - 1, Math.round((clientX - rect.left - M.left) / slot - 0.5)));
    // Dragging a finger across the chart ticks over each day, like a slider's detents.
    if (touch && i !== lastIdx.current) haptics.detent(0.3);
    lastIdx.current = i;
    setHover(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hover ?? (e.key === 'ArrowLeft' ? days.length : -1);
    const next = e.key === 'ArrowRight' ? withData.find((i) => i > cur) : [...withData].reverse().find((i) => i < cur);
    if (next !== undefined) setHover(next);
  };

  const barW = Math.max(1, Math.min(24, slot * 0.7));
  const nS = series.length;
  const sub = nS > 1 && kind === 'bar' ? Math.max(1, (barW - (nS - 1) * 2) / nS) : barW;

  const hoverRows =
    hover === null
      ? []
      : series.flatMap((s, si) => {
          const p = g.byIdx[si].get(hover);
          return p ? [{ s, p }] : [];
        });

  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover), 70), W - 70);

  return (
    <div
      ref={wrap}
      className="chart"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={(e) => move(e.clientX, e.pointerType === 'touch')}
      onPointerDown={(e) => move(e.clientX, e.pointerType === 'touch')}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={onKey}
    >
      <svg width={W} height={height} aria-hidden="true">
        {rating && kind === 'line' && (
          <defs>
            {/* Follows the axis: the line takes the colour of the height it is at. Stops from the top of the plot down. */}
            <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={M.top} y2={M.top + plotH}>
              {[...rating.stops]
                .sort((a, b) => b.at - a.at)
                .map((st, i) => (
                  <stop key={i} offset={Math.max(0, Math.min(1, (y(toDisplay(st.at)) - M.top) / plotH))} style={{ stopColor: st.color }} />
                ))}
            </linearGradient>
          </defs>
        )}
        {g.ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {axisFmt(t)}
            </text>
          </g>
        ))}
        {kind === 'bar' && <line x1={M.left} x2={W - M.right} y1={y(g.yMin)} y2={y(g.yMin)} className="axis" />}
        {labelIdx.map((i, k) => (
          <text
            key={i}
            x={x(i)}
            y={height - 6}
            className="tick"
            textAnchor={k === 0 && labelIdx.length > 2 ? 'start' : k === labelIdx.length - 1 && labelIdx.length > 2 ? 'end' : 'middle'}
          >
            {dateLabel(days[i])}
          </text>
        ))}

        {kind === 'bar' &&
          series.map((s, si) =>
            [...g.byIdx[si]].map(([i, p]) => {
              const bx = x(i) - barW / 2 + si * (sub + 2);
              return (
                <path
                  key={`${s.key}${i}`}
                  d={barPath(bx, sub, y(toDisplay(p.value)), y(Math.max(0, g.yMin)))}
                  fill={rating ? rating.color(p.value) : cvar(s.color)}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              );
            }),
          )}

        {kind === 'line' &&
          series.map((s, si) => {
            const pts = [...g.byIdx[si]].sort((a, b) => a[0] - b[0]);
            if (!pts.length) return null;
            const band = pts.filter(([, p]) => p.min !== undefined && p.max !== undefined && p.max !== p.min);
            const path = pts.map(([i, p], k) => `${k ? 'L' : 'M'}${x(i)},${y(toDisplay(p.value))}`).join('');
            const [li, lp] = pts[pts.length - 1];
            return (
              <g key={s.key}>
                {series.length === 1 && band.length > 1 && (
                  <path
                    d={
                      band.map(([i, p], k) => `${k ? 'L' : 'M'}${x(i)},${y(toDisplay(p.max!))}`).join('') +
                      [...band].reverse().map(([i, p]) => `L${x(i)},${y(toDisplay(p.min!))}`).join('') +
                      'Z'
                    }
                    fill={cvar(s.color)}
                    opacity={0.1}
                  />
                )}
                <path d={path} fill="none" stroke={rating ? `url(#${gradId})` : cvar(s.color)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(li)} cy={y(toDisplay(lp.value))} r={4} fill={rating ? rating.color(lp.value) : cvar(s.color)} className="ring" />
                {series.length === 1 && (
                  <text
                    x={Math.min(x(li), W - M.right)}
                    y={y(toDisplay(lp.value)) - 10}
                    className="endlabel"
                    textAnchor={x(li) > W - 60 ? 'end' : 'middle'}
                  >
                    {tipFmt(lp.value)}
                  </text>
                )}
              </g>
            );
          })}

        {hover !== null && kind === 'line' && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} className="crosshair" />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.key} cx={x(hover)} cy={y(toDisplay(p.value))} r={4} fill={rating ? rating.color(p.value) : cvar(s.color)} className="ring" />
            ))}
          </>
        )}
      </svg>

      {hover !== null && (
        <div className="tip" style={{ left: tipLeft }} id={`${id}-tip`}>
          <div className="tip-date">{dateLabel(days[hover], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          {hoverRows.length === 0 && <div className="tip-none">No data</div>}
          {hoverRows.map(({ s, p }) => (
            <div className="tip-row" key={s.key}>
              <span className={kind === 'bar' ? 'key-box' : 'key-line'} style={{ background: rating ? rating.color(p.value) : cvar(s.color) }} />
              <strong>{tipFmt(p.value)}</strong>
              {rating && <span className="tip-label">{rating.label(p.value)}</span>}
              {series.length > 1 && <span className="tip-label">{s.label}</span>}
              {p.min !== undefined && p.max !== undefined && p.max !== p.min && series.length === 1 && (
                <span className="tip-label">
                  {tipFmt(p.min)}–{tipFmt(p.max)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
