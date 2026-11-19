import { useCallback, useEffect, useState } from 'react';
import { isLocal, isNative, onConnChange, type Me } from './lib/api';
import { localRefresh } from './lib/localsync';
import { LOCAL_ME, enterLocal, restore, signOut } from './lib/session';
import { Icon } from './components/icons';
import { haptics } from './lib/haptics';
import { checkForUpdate, initUpdates, updateAvailable, useUpdates } from './lib/updates';
import { useUnits } from './lib/data';
import { pushCatalog, refreshWidgets, widgets } from './lib/widgets';
import { Logo } from './components/Logo';
import { PullToRefresh } from './components/PullToRefresh';
import { RangeBar, Spinner } from './components/ui';
import { Login } from './screens/Login';
import { Overview } from './screens/Overview';
import { Sleep } from './screens/Sleep';
import { Metrics } from './screens/Metrics';
import { Settings } from './screens/Settings';

// Look for a new app version when the app opens and each time it comes back into view (Android app only).
initUpdates();

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'home', ranged: false },
  { id: 'sleep', label: 'Sleep', icon: 'moon', ranged: true },
  { id: 'activity', label: 'Activity', icon: 'run', ranged: true },
  { id: 'vitals', label: 'Vitals', icon: 'heart', ranged: true },
  { id: 'body', label: 'Body', icon: 'body', ranged: true },
  { id: 'settings', label: 'Settings', icon: 'settings', ranged: false },
] as const;
type Tab = (typeof TABS)[number]['id'];

const fromHash = (): Tab => {
  const h = location.hash.replace(/^#\/?/, '');
  return (TABS.find((t) => t.id === h)?.id ?? 'overview') as Tab;
};

export function App() {
  const [boot, setBoot] = useState<'loading' | 'ready'>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [tab, setTabState] = useState<Tab>(fromHash);
  // Changes when the user signs in as someone else, so no screen keeps the last person's data.
  const [epoch, setEpoch] = useState(0);
  // On-device mode: the user opened the sign-in screen to connect to a server.
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    restore().then((r) => {
      setMe(r.me);
      setNeedsSetup(r.needsSetup);
      setBoot('ready');
    });
  }, []);

  useEffect(() => {
    const h = () => setTabState(fromHash());
    window.addEventListener('hashchange', h);
    const out = () => setMe(null);
    const req = async () => {
      await signOut();
      setMe(isLocal() ? LOCAL_ME : null); // the Android app carries on standalone; a browser goes back to the login
      setEpoch((e) => e + 1);
    };
    window.addEventListener('hc:signed-out', out);
    window.addEventListener('hc:sign-out-request', req);
    const connect = () => setConnecting(true);
    window.addEventListener('hc:connect-server', connect);
    const un = onConnChange(() => {});
    return () => {
      window.removeEventListener('hashchange', h);
      window.removeEventListener('hc:signed-out', out);
      window.removeEventListener('hc:sign-out-request', req);
      window.removeEventListener('hc:connect-server', connect);
      un();
    };
  }, []);

  // Home screen widgets: give them the app's metric definitions (again when units change), redraw them after data
  // changes, and open the screen a tapped widget asked for.
  const units = useUnits();
  const updates = useUpdates();
  useEffect(() => {
    // Each finished sync also looks for a new version; checkForUpdate skips it if it asked in the last 5 minutes.
    const check = () => void checkForUpdate();
    window.addEventListener('hc:synced', check);
    return () => window.removeEventListener('hc:synced', check);
  }, []);
  useEffect(() => {
    void pushCatalog(units);
  }, [units]);
  useEffect(() => {
    const w = widgets;
    if (!w) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshWidgets(), 3000); // a burst of changes is one redraw
    };
    const route = () => w.takeRoute().then((r) => { if (r.route && r.route !== 'overview') location.hash = `/${r.route}`; }).catch(() => {});
    const visible = () => document.visibilityState === 'visible' && route();
    window.addEventListener('hc:data-changed', changed);
    window.addEventListener('hc:synced', changed);
    document.addEventListener('visibilitychange', visible);
    void route();
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hc:data-changed', changed);
      window.removeEventListener('hc:synced', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  // On-device mode: read Health Connect when the app opens and whenever it comes back into view.
  useEffect(() => {
    if (!me || !isLocal()) return;
    localRefresh().catch(() => {});
    const visible = () => document.visibilityState === 'visible' && localRefresh().catch(() => {});
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [me, epoch]);

  const go = useCallback((t: string) => {
    location.hash = `/${t}`;
  }, []);

  if (boot === 'loading') return <div className="center full"><Spinner /></div>;
  if (!me || connecting) {
    return (
      <Login
        key={epoch}
        needsSetup={needsSetup}
        onLocal={isNative && !connecting ? () => { setMe(enterLocal()); setEpoch((e) => e + 1); location.hash = '/overview'; } : undefined}
        onBack={connecting ? () => setConnecting(false) : undefined}
        onDone={(m) => {
          setConnecting(false);
          setMe(m);
          setNeedsSetup(false);
          setEpoch((e) => e + 1);
          location.hash = '/overview';
        }}
      />
    );
  }

  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <div className="shell" key={epoch}>
      <nav className="nav" aria-label="Sections">
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} onClick={() => t.id !== tab && haptics.step()} className={'nav-item' + (t.id === tab ? ' on' : '')} aria-current={t.id === tab ? 'page' : undefined}>
            <span className="pill"><Icon name={t.icon} size={24} /></span>
            <span className="nav-label">{t.label}</span>
          </a>
        ))}
      </nav>
      <PullToRefresh />
      <div className="content">
        <div className="appbar">
          <Logo size={30} />
          <span className="brand md-typescale-title-large">HealthConnector</span>
        </div>
        <header className="top">
          <h1 className="md-typescale-headline-small">{cur.label}</h1>
          {cur.ranged && <RangeBar />}
        </header>
        {updateAvailable(updates) && tab !== 'settings' && (
          <button className="update-bar" onClick={() => go('settings')}>
            <Icon name="download" size={18} />
            <span>Version {updates.latest} of HealthConnector is ready. Tap to update.</span>
          </button>
        )}
        <main>
          {tab === 'overview' && <Overview onGo={go} />}
          {tab === 'sleep' && <Sleep />}
          {tab === 'activity' && <Metrics keys={['steps', 'distance', 'active_calories', 'total_calories', 'exercise']} extra="exercise" />}
          {tab === 'vitals' && <Metrics keys={['heart_rate', 'resting_heart_rate', 'hrv', 'oxygen_saturation', 'respiratory_rate', 'body_temperature', 'blood_glucose']} extra="bp" />}
          {tab === 'body' && <Metrics keys={['weight', 'body_fat', 'height', 'hydration', 'nutrition']} />}
          {tab === 'settings' && <Settings me={me} />}
        </main>
      </div>
    </div>
  );
}
