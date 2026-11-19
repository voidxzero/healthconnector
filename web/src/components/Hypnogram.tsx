import { useEffect, useMemo, useRef, useState } from 'react';
import { LANES, STAGE, layout, totals, type Segment } from '../lib/hypnogram';
import { hm, timeLabel } from '../lib/metrics';

const GUTTER = 40; // room for the lane names
const LANE_H = 16;
const GAP = 5;
const TOP = 4;
const AXIS_H = 20;
const H = TOP + LANES.length * LANE_H + (LANES.length - 1) * GAP + AXIS_H;
const laneY = (lane: number) => TOP + lane * (LANE_H + GAP);

const cvar = (c: string) => `var(--c-${c})`;

/**
 * One night as a timeline: each stretch of awake, REM, light or deep sleep sits at its own time and its own level,
 * with a hairline joining each step to the next. The wording underneath (and the tooltip) says the same in text.
 */
export function Hypnogram({ start, end, segments }: { start: string; end: string; segments: Segment[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(220, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(220, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const t0 = Date.parse(start);
  const totalMin = Math.max(1, (Date.parse(end) - t0) / 60000);
  const plotW = width - GUTTER;
  const blocks = useMemo(() => layout(segments, totalMin, plotW), [segments, totalMin, plotW]);
  const sum = useMemo(() => totals(segments), [segments]);

  // Hour marks along the bottom, as many as fit with room for their labels.
  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const d = new Date(t0);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    const stepH = totalMin / 60 > 7 ? 2 : 1;
    for (let t = d.getTime(); t < t0 + totalMin * 60000 - 20 * 60000; t += stepH * 3600000) {
      out.push({ x: ((t - t0) / 60000 / totalMin) * plotW, label: new Date(t).toLocaleTimeString([], { hour: 'numeric' }) });
    }
    return out.filter((tk, i, a) => tk.x > 40 && tk.x < plotW - 40 && (i === 0 || tk.x - a[i - 1].x >= 44));
  }, [t0, totalMin, plotW]);

  const at = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const min = ((clientX - rect.left - GUTTER) / plotW) * totalMin;
    const i = blocks.findIndex((b) => min >= b.at && min < b.at + b.dur);
    setHover(i >= 0 ? i : null);
  };

  const hb = hover === null ? null : blocks[hover];
  const label = (['d', 'l', 'r', 'a'] as const).map((c) => `${STAGE[c].label} ${hm(sum[c])}`).join(', ');
  const clock = (min: number) => timeLabel(new Date(t0 + min * 60000).toISOString());

  return (
    <div
      ref={wrap}
      className="hyp"
      style={{ height: H }}
      role="img"
      aria-label={`Sleep stages through the night: ${label}`}
      onPointerMove={(e) => at(e.clientX)}
      onPointerDown={(e) => at(e.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={width} height={H} aria-hidden="true">
        {LANES.map((code, lane) => (
          <g key={code}>
            <line x1={GUTTER} x2={width} y1={laneY(lane) + LANE_H / 2} y2={laneY(lane) + LANE_H / 2} className="grid" />
            <text x={GUTTER - 8} y={laneY(lane) + LANE_H / 2} className="tick" textAnchor="end" dominantBaseline="middle">
              {STAGE[code].label}
            </text>
          </g>
        ))}
        {/* the steps between stages, behind the blocks */}
        {blocks.slice(1).map((b, i) => {
          const prev = blocks[i];
          if (prev.lane === b.lane) return null;
          const x = GUTTER + b.x;
          return <line key={i} x1={x} x2={x} y1={laneY(prev.lane) + LANE_H / 2} y2={laneY(b.lane) + LANE_H / 2} className="axis" />;
        })}
        {blocks.map((b, i) => (
          <rect
            key={i}
            x={GUTTER + b.x}
            y={laneY(b.lane)}
            width={b.w}
            height={LANE_H}
            rx={Math.min(4, b.w / 2)}
            fill={cvar(STAGE[b.code].color)}
            opacity={hover === null || hover === i ? 1 : 0.55}
          />
        ))}
        {ticks.map((tk) => (
          <text key={tk.label + tk.x} x={GUTTER + tk.x} y={H - 5} className="tick" textAnchor="middle">
            {tk.label}
          </text>
        ))}
      </svg>
      {hb && (
        <div className="tip" style={{ left: Math.min(Math.max(GUTTER + hb.x + hb.w / 2, 70), width - 70) }}>
          <div className="tip-row">
            <span className="key-box" style={{ background: cvar(STAGE[hb.code].color) }} />
            <strong>{STAGE[hb.code].label}</strong>
            <span className="tip-label">{hm(hb.dur)}</span>
          </div>
          <div className="tip-date">
            {clock(hb.at)} – {clock(hb.at + hb.dur)}
          </div>
        </div>
      )}
    </div>
  );
}
