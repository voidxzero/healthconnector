import { useEffect, useRef, useState } from 'react';
import { haptics } from '../lib/haptics';
import { refreshAll } from '../lib/refresh';
import { Icon } from './icons';

const THRESHOLD = 70; // how far (after damping) the page has to be pulled

/**
 * Swipe down at the top of any screen to sync.
 * A round indicator follows the finger (its arrow turns, and it changes colour once you've pulled far enough);
 * letting go makes it spin; then it turns into a green check, or a red cross if it failed, and a toast says what happened.
 * A tiny check in the corner also appears after any successful sync, including the automatic ones.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'ok' | 'failed' | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [tick, setTick] = useState(0);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const start = useRef<number | null>(null);

  const say = (text: string) => setToast({ text, key: Date.now() });

  useEffect(() => {
    const reset = () => {
      pullRef.current = 0;
      setPull(0);
    };
    const run = async () => {
      busyRef.current = true;
      setBusy(true);
      setResult(null);
      let ok = true;
      try {
        say(await refreshAll());
      } catch (e: any) {
        ok = false;
        say(e?.message || 'Sync failed');
      }
      busyRef.current = false;
      setBusy(false);
      setResult(ok ? 'ok' : 'failed');
      if (ok) haptics.synced();
      else haptics.failed();
      reset();
      setTimeout(() => setResult(null), 1400);
    };
    const onStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      // Not while something else is being scrolled or typed into
      if (window.scrollY > 0 || busyRef.current || e.touches.length !== 1 || t?.closest('md-dialog, .table-wrap, input, textarea')) return;
      start.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      if (window.scrollY > 0) {
        start.current = null;
        return reset();
      }
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0) return reset();
      const next = Math.min(110, dy * 0.5);
      if (next >= THRESHOLD !== pullRef.current >= THRESHOLD) haptics.detent();
      pullRef.current = next;
      setPull(next);
    };
    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      if (pullRef.current >= THRESHOLD && !busyRef.current) run();
      else reset();
    };
    // Any successful sync (background ones too) gets a small tick in the corner.
    const onSynced = () => setTick(Date.now());
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    window.addEventListener('hc:synced', onSynced);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      window.removeEventListener('hc:synced', onSynced);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!tick) return;
    const t = setTimeout(() => setTick(0), 1800);
    return () => clearTimeout(t);
  }, [tick]);

  const pulling = pull > 8;
  return (
    <>
      {tick > 0 && !pulling && !busy && result === null && (
        <span key={tick} className="sync-tick" role="status" aria-label="Synced">
          <Icon name="check" size={12} />
        </span>
      )}
      {result && !busy && !pulling && (
        <div className={`ptr done ${result}`} role="status" aria-label={result === 'ok' ? 'Synced' : 'Sync failed'}>
          <Icon name={result === 'ok' ? 'check' : 'close'} size={22} />
        </div>
      )}
      {(pulling || busy) && (
        <div
          className={'ptr' + (pull >= THRESHOLD ? ' ready' : '') + (busy ? ' busy' : '')}
          style={{ transform: `translateY(${busy ? 24 : pull - 30}px)`, opacity: busy ? 1 : Math.min(1, pull / THRESHOLD) }}
          aria-hidden="true"
        >
          <span style={busy ? undefined : { display: 'inline-flex', transform: `rotate(${pull * 3}deg)` }}>
            <Icon name="sync" size={20} />
          </span>
        </div>
      )}
      {toast && (
        <div key={toast.key} className="toast" role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </>
  );
}
