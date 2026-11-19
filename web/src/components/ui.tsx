import { useEffect, useRef, type ReactNode } from 'react';
import { RANGES, setRange, useRange } from '../lib/data';
import { haptics } from '../lib/haptics';
import { Icon } from './icons';

/** The one shared range filter: a single row above the content, scoping everything below it. */
export function RangeBar() {
  const range = useRange();
  const label = (n: number) => (n === 365 ? '1 year' : `${n} days`);
  return (
    <div className="rangebar" role="group" aria-label="Date range">
      {RANGES.map((n) => (
        <button key={n} className={'seg' + (n === range ? ' on' : '')} aria-pressed={n === range} onClick={() => { if (n !== range) haptics.step(); setRange(n); }}>
          {n === range && <Icon name="check" size={16} />}
          {label(n)}
        </button>
      ))}
    </div>
  );
}

/** Switches a chart between bars and a line; shows the one you'd switch to. */
export function KindToggle({ kind, onToggle }: { kind: 'bar' | 'line'; onToggle: () => void }) {
  const label = kind === 'bar' ? 'Show as line chart' : 'Show as bar chart';
  return (
    <button className="icon-btn" onClick={() => { haptics.step(); onToggle(); }} title={label}>
      <Icon name={kind === 'bar' ? 'line' : 'bars'} />
      <span className="sr">{label}</span>
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={'card ' + className}>{children}</section>;
}

export function Banner({ icon = 'cloudOff', children, tone }: { icon?: string; children: ReactNode; tone?: 'error' }) {
  return (
    <div className={'banner' + (tone ? ' ' + tone : '')} role="status">
      <Icon name={icon} size={20} />
      <span>{children}</span>
    </div>
  );
}

export function Spinner() {
  return <md-circular-progress indeterminate aria-label="Loading" style={{ '--md-circular-progress-size': '32px' } as any} />;
}

export function Field({
  label, value, onChange, type = 'text', onEnter, autoComplete, error, supporting, autoFocus, name,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; onEnter?: () => void;
  autoComplete?: string; error?: string; supporting?: string; autoFocus?: boolean; name?: string;
}) {
  return (
    <md-outlined-text-field
      label={label}
      value={value}
      type={type}
      name={name}
      autocomplete={autoComplete}
      error={error ? true : undefined}
      error-text={error}
      supporting-text={error ? undefined : supporting}
      autofocus={autoFocus}
      onInput={(e: any) => onChange(e.target.value)}
      onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && onEnter?.()}
      class="field"
    />
  );
}

export function Dialog({
  open, onClose, title, children, actions,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<any>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => onClose();
    el.addEventListener('closed', h);
    return () => el.removeEventListener('closed', h);
  }, [onClose]);
  useEffect(() => {
    if (ref.current) ref.current.open = open;
  }, [open]);
  return (
    <md-dialog ref={ref}>
      <div slot="headline">{title}</div>
      <div slot="content" className="dialog-body">{children}</div>
      <div slot="actions">{actions}</div>
    </md-dialog>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="empty">
      <h2 className="md-typescale-title-large">{title}</h2>
      <p className="muted">{children}</p>
    </Card>
  );
}
