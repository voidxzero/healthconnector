import type { Day } from '../lib/metrics';

/** A 14-point trend in the quiet ink, with the latest point in the accent. */
export function Spark({ days, data, color }: { days: string[]; data: Day[]; color: string }) {
  const by = new Map(data.map((d) => [d.date, d.value]));
  const pts = days.map((d, i) => [i, by.get(d)] as const).filter((p): p is readonly [number, number] => p[1] !== undefined);
  if (pts.length < 2) return <div className="spark" />;
  const W = 120, H = 32, P = 4;
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  const x = (i: number) => P + (i / (days.length - 1)) * (W - 2 * P);
  const y = (v: number) => (hi === lo ? H / 2 : H - P - ((v - lo) / (hi - lo)) * (H - 2 * P));
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path d={d} fill="none" className="spark-line" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r={3.5} fill={color} className="ring" />
    </svg>
  );
}
