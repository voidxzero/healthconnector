import { useEffect, useState } from 'react';
import { ApiError, api, getConn, isNative, type Me, type PasswordPolicy } from '../lib/api';
import { policyHint, usePolicy } from '../lib/policy';
import { signIn } from '../lib/session';
import { Card, Field } from '../components/ui';
import { Logo } from '../components/Logo';
import { haptics } from '../lib/haptics';

export function Login({
  needsSetup: initialSetup, onDone, onLocal, onBack,
}: {
  needsSetup: boolean;
  onDone: (me: Me) => void;
  /** Android: use the app with no server. */
  onLocal?: () => void;
  /** Shown when this screen was opened from on-device mode: go back to it. */
  onBack?: () => void;
}) {
  const c = getConn();
  const [server, setServer] = useState(c.serverUrl);
  const [backup, setBackup] = useState(c.backupUrl);
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [needsSetup, setNeedsSetup] = useState(initialSetup);
  const web = usePolicy();
  const [probed, setProbed] = useState<PasswordPolicy | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // In the app, find out whether this server still needs its first account once an address is typed.
  useEffect(() => {
    if (!isNative || !server.trim()) return;
    const t = setTimeout(() => api.probe(server).then((s) => { setNeedsSetup(s.needs_setup); setProbed(s.password_policy); }).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [server]);

  const submit = async () => {
    setErr('');
    if (needsSetup && pw !== pw2) return setErr("The passwords don't match");
    setBusy(true);
    try {
      const me = await signIn({ serverUrl: server, backupUrl: backup, username: user, password: pw, create: needsSetup });
      haptics.synced();
      onDone(me);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-brand">
        <span className="logo"><Logo size={40} /></span>
        <h1 className="md-typescale-headline-medium">HealthConnector</h1>
        <p className="muted">Your Health Connect data, on your own server.</p>
      </div>
      <Card className="login-card">
        <h2 className="md-typescale-title-large">{needsSetup ? 'Create your account' : onBack ? 'Connect to a server' : 'Sign in'}</h2>
        {onBack && !needsSetup && <p className="muted">Optional. Connecting sends your Health Connect data to your own server too, so you can see it on other devices. The app works fine without one.</p>}
        {needsSetup && <p className="muted">This server has no accounts yet. The first one becomes the admin; you can add others afterwards.</p>}
        {isNative && (
          <>
            <Field label="Server address" value={server} onChange={setServer} supporting="e.g. 192.168.1.20:8000 or health.example.com" autoComplete="url" />
            <Field label="Local address (optional)" value={backup} onChange={setBackup} supporting="Used when the main address can't be reached, such as your home Wi-Fi IP" />
          </>
        )}
        <Field label="Username" value={user} onChange={setUser} autoComplete="username" autoFocus={!isNative} />
        <Field label="Password" type="password" value={pw} onChange={setPw} onEnter={needsSetup ? undefined : submit} autoComplete={needsSetup ? 'new-password' : 'current-password'} supporting={needsSetup ? policyHint(isNative ? probed : web.policy) : undefined} />
        {needsSetup && <Field label="Repeat password" type="password" value={pw2} onChange={setPw2} onEnter={submit} autoComplete="new-password" />}
        {err && <p className="error" role="alert">{err}</p>}
        <md-filled-button onClick={submit} disabled={busy || !user || !pw} class="wide">
          {busy ? 'Please wait…' : needsSetup ? 'Create account' : onBack ? 'Connect' : 'Sign in'}
        </md-filled-button>
      </Card>
      {onLocal && (
        <div className="local-choice">
          <md-outlined-button onClick={onLocal}>Use on this phone only</md-outlined-button>
          <p className="muted small">No server or account. Your Health Connect data is read and shown on this phone, and nothing leaves it.</p>
        </div>
      )}
      {onBack && <md-text-button onClick={onBack}>Back to this phone's data</md-text-button>}
    </main>
  );
}
