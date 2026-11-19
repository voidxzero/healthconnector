import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, getConn, isLocal, isNative, serverVersion, normalizeUrl, setConn, type Me, type PasswordPolicy, type SyncToken } from '../lib/api';
import { policyHint, usePolicy } from '../lib/policy';
import { refreshWidgets, widgets } from '../lib/widgets';
import { sourceName } from '../lib/sources';
import { TYPES } from '../lib/localdata';
import { METRICS } from '../lib/metrics';
import { checkForUpdate, installUpdate, isNewer, updateAvailable, useUpdates } from '../lib/updates';
import { haptics, hapticsAvailable, hapticsEnabled, setHapticsEnabled } from '../lib/haptics';
import { health } from '../lib/health';
import { setUnits, useFetch, useUnits } from '../lib/data';
import { ensurePhoneSync } from '../lib/session';
import { clearLocalData, localError, localLastSync, localRefresh, refreshAfterAccess } from '../lib/localsync';
import { Banner, Card, Dialog, Field } from '../components/ui';
import { Icon } from '../components/icons';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');

/** How often the phone syncs by itself. Android won't run a background job more often than every 15 minutes. */
const SYNC_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 120, label: 'Every 2 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Once a day' },
  { minutes: 0, label: 'Only when I sync' },
];

type Sdk = Awaited<ReturnType<NonNullable<typeof health>['status']>>;

function PhoneSync() {
  const local = isLocal();
  const [st, setSt] = useState<Sdk | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const refresh = useCallback(async () => {
    try { setSt(await health!.status()); } catch (e) { setMsg(String(e)); }
  }, []);
  useEffect(() => {
    ensurePhoneSync().catch(() => {}).finally(refresh); // does nothing in on-device mode
  }, [refresh]);
  if (!st) return null;

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg('');
    try { await f(); if (ok) setMsg(ok); haptics.synced(); } catch (e: any) { setMsg(e?.message || 'Something went wrong'); haptics.failed(); }
    setBusy(false);
    refresh();
  };

  return (
    <Card>
      <h2 className="md-typescale-title-medium">{local ? 'Health Connect' : 'Health Connect sync'}</h2>
      {st.sdk !== 'available' ? (
        <>
          <p className="muted">{st.sdk === 'update_required' ? 'Health Connect needs an update before it can be read.' : 'Health Connect isn\'t available on this phone.'}</p>
          <md-filled-tonal-button onClick={() => health!.openHealthConnect()}>Open Health Connect</md-filled-tonal-button>
        </>
      ) : (
        <>
          <p>{st.missing === 0 ? 'All data types allowed.' : `${st.total - st.missing} of ${st.total} data types allowed.`}</p>
          <p className="muted small">{local ? `Last read: ${localLastSync() ? new Date(localLastSync()).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'}` : `Last sync: ${st.lastStatus || 'never'}`}</p>
          <div className="row">
            {st.missing > 0 && <md-filled-button onClick={() => run(async () => { await health!.requestAccess(); if (local) await refreshAfterAccess(); })} disabled={busy}>Allow access</md-filled-button>}
            <md-filled-tonal-button onClick={() => run(async () => {
              if (local) { const n = await localRefresh(true); setMsg(n === null ? 'Nothing to read yet.' : `Read ${n} records.`); return; }
              await ensurePhoneSync(); const r = await health!.syncNow(); setMsg(`Sent ${r.sent} records.`);
            })} disabled={busy || st.missing === st.total}>
              <Icon name="sync" size={18} /> {busy ? (local ? 'Reading…' : 'Syncing…') : local ? 'Refresh now' : 'Sync now'}
            </md-filled-tonal-button>
          </div>
          <HealthCheck info={st} />
          {local ? (
            <p className="muted small">It also refreshes whenever you open the app.</p>
          ) : (
            <>
              <md-outlined-select
                label="Sync automatically"
                class="field mt"
                value={String(st.intervalMinutes)}
                onChange={async (e: any) => {
                  haptics.step();
                  try { await health!.setInterval({ minutes: Number(e.target.value) }); setMsg(''); } catch (err: any) { setMsg(err?.message || 'Could not change that'); }
                  refresh();
                }}
              >
                {SYNC_CHOICES.map((c) => (
                  <md-select-option key={c.minutes} value={String(c.minutes)}>
                    <div slot="headline">{c.label}</div>
                  </md-select-option>
                ))}
              </md-outlined-select>
              <p className="muted small">
                {st.intervalMinutes === 0
                  ? 'Automatic sync is off. Swipe down on any screen, or tap Sync now.'
                  : 'Android picks the exact moment and may delay it to save battery. Syncing more often uses more battery.'}
              </p>
            </>
          )}
        </>
      )}
      {local && localError() && <p role="alert" className="error small">Some data couldn't be read: {localError()}</p>}
      {msg && <p role="status" className="small">{msg}</p>}
    </Card>
  );
}

function ServerCard() {
  const c = getConn();
  const [backup, setBackup] = useState(c.backupUrl);
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Your server</h2>
      <p className="muted">Main address: {c.serverUrl}</p>
      <Field label="Local address (optional)" value={backup} onChange={(v) => { setBackup(v); setSaved(false); }} supporting="Used when the main address can't be reached" />
      <div className="row">
        <md-filled-tonal-button onClick={async () => {
          const url = normalizeUrl(backup);
          if (url) {
            try { const st = await api.probe(url); if (st.instance_id !== c.instanceId) { alert("That address belongs to a different server."); return; } }
            catch { alert("Couldn't reach that address from here. Saved anyway."); }
          }
          setConn({ backupUrl: url });
          if (c.syncTokenId) setConn({ syncTokenId: null }); // re-send the new address to the background sync
          ensurePhoneSync().catch(() => {});
          setSaved(true);
        }}>Save</md-filled-tonal-button>
        {saved && <span className="muted small">Saved</span>}
      </div>
    </Card>
  );
}

function Devices() {
  const t = useFetch<SyncToken[]>('/api/tokens');
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Devices sending data</h2>
      {!t.data?.length && <p className="muted">None yet. A device appears here after you sign in on the Android app.</p>}
      <ul className="list">
        {t.data?.map((p) => (
          <li key={p.id}>
            <div><strong>{p.label}</strong><br /><span className="muted small">Added {when(p.created_at)} · last sync {when(p.last_used_at)}</span></div>
            <button className="icon-btn" title="Remove" onClick={async () => { if (confirm(`Remove "${p.label}"? It will stop sending data until you sign in on it again.`)) { await api.revokeToken(p.id); t.reload(); } }}>
              <Icon name="delete" /><span className="sr">Remove</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Account({ me }: { me: Me }) {
  const hint = policyHint(usePolicy().policy);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const close = useCallback(() => { setOpen(false); setCur(''); setN1(''); setN2(''); setErr(''); }, []);
  const submit = async () => {
    if (n1 !== n2) return setErr("The new passwords don't match");
    try { await api.changePassword(cur, n1); close(); setDone(true); haptics.done(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); haptics.failed(); }
  };
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Account</h2>
      <p><Icon name="person" size={18} /> {me.username} {me.is_admin && <span className="chip">Admin</span>}</p>
      <div className="row">
        <md-outlined-button onClick={() => { setOpen(true); setDone(false); }}><Icon name="key" size={18} /> Change password</md-outlined-button>
        <md-text-button onClick={() => window.dispatchEvent(new Event('hc:sign-out-request'))}><Icon name="logout" size={18} /> Sign out</md-text-button>
      </div>
      {done && <p role="status" className="small">Password changed. Other devices were signed out.</p>}
      {isNative && <p className="muted small">Signing out disconnects from the server. The app keeps working on this phone's own data.</p>}
      <Dialog open={open} onClose={close} title="Change password"
        actions={<><md-text-button onClick={close}>Cancel</md-text-button><md-filled-button onClick={submit} disabled={!cur || !n1}>Change</md-filled-button></>}>
        <Field label="Current password" type="password" value={cur} onChange={setCur} autoComplete="current-password" />
        <Field label="New password" type="password" value={n1} onChange={setN1} autoComplete="new-password" supporting={hint} />
        <Field label="Repeat new password" type="password" value={n2} onChange={setN2} onEnter={submit} autoComplete="new-password" error={err} />
      </Dialog>
    </Card>
  );
}

function Users({ meId }: { meId: number }) {
  const hint = policyHint(usePolicy().policy);
  const users = useFetch<(Me & { created_at: string })[]>('/api/users');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [pw, setPw] = useState(''); const [admin, setAdmin] = useState(false);
  const [err, setErr] = useState('');
  const [reset, setReset] = useState<Me | null>(null); const [rpw, setRpw] = useState('');
  const close = useCallback(() => { setOpen(false); setName(''); setPw(''); setAdmin(false); setErr(''); }, []);
  const closeReset = useCallback(() => { setReset(null); setRpw(''); setErr(''); }, []);
  const add = async () => {
    try { await api.addUser(name, pw, admin); close(); users.reload(); haptics.done(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); haptics.failed(); }
  };
  const doReset = async () => {
    try { await api.resetPassword(reset!.id, rpw); closeReset(); haptics.done(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); haptics.failed(); }
  };
  return (
    <Card>
      <h2 className="md-typescale-title-medium">People</h2>
      <p className="muted">Each person has their own data. Give them the username and password you set; they can change it after signing in.</p>
      <ul className="list">
        {users.data?.map((u) => (
          <li key={u.id}>
            <div><strong>{u.username}</strong> {u.is_admin && <span className="chip">Admin</span>}</div>
            <div className="row">
              <md-text-button onClick={() => setReset(u)}>Reset password</md-text-button>
              {u.id !== meId && (
                <button className="icon-btn" title="Delete" onClick={async () => { if (confirm(`Delete ${u.username} and all of their data? This can't be undone.`)) { await api.deleteUser(u.id); users.reload(); } }}>
                  <Icon name="delete" /><span className="sr">Delete {u.username}</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <md-filled-tonal-button onClick={() => setOpen(true)}><Icon name="add" size={18} /> Add person</md-filled-tonal-button>
      <Dialog open={open} onClose={close} title="Add person"
        actions={<><md-text-button onClick={close}>Cancel</md-text-button><md-filled-button onClick={add} disabled={!name || !pw}>Add</md-filled-button></>}>
        <Field label="Username" value={name} onChange={setName} autoComplete="off" />
        <Field label="Password" type="password" value={pw} onChange={setPw} autoComplete="new-password" supporting={hint} error={err} />
        <label className="check"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Can manage people</label>
      </Dialog>
      <Dialog open={!!reset} onClose={closeReset} title={`Reset password for ${reset?.username ?? ''}`}
        actions={<><md-text-button onClick={closeReset}>Cancel</md-text-button><md-filled-button onClick={doReset} disabled={!rpw}>Reset</md-filled-button></>}>
        <p className="muted">They'll be signed out everywhere.</p>
        <Field label="New password" type="password" value={rpw} onChange={setRpw} autoComplete="new-password" supporting={hint} error={err} />
      </Dialog>
    </Card>
  );
}

const RULES: { key: keyof PasswordPolicy; label: string }[] = [
  { key: 'require_upper', label: 'Uppercase letter' },
  { key: 'require_lower', label: 'Lowercase letter' },
  { key: 'require_digit', label: 'Number' },
  { key: 'require_symbol', label: 'Symbol' },
];

/** Admin only: how long and how complex a new password has to be. */
function PasswordRules() {
  const { policy, reload } = usePolicy();
  const [draft, setDraft] = useState<PasswordPolicy | null>(null);
  const [len, setLen] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (policy && !draft) { setDraft(policy); setLen(String(policy.min_length)); }
  }, [policy, draft]);
  if (!draft) return null;
  const n = Number(len);
  const bad = !Number.isInteger(n) || n < 1 || n > 128 ? 'Enter a number from 1 to 128' : '';
  const save = async () => {
    try {
      const saved = await api.setPasswordPolicy({ ...draft, min_length: n });
      setDraft(saved); setLen(String(saved.min_length)); setMsg('Saved'); reload(); haptics.done();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Failed'); }
  };
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Password rules</h2>
      <p className="muted">Applies when a password is set or changed from now on. Passwords people already have keep working.</p>
      <Field label="Minimum length" type="number" value={len} onChange={(v) => { setLen(v); setMsg(''); }} error={bad} supporting="Characters" />
      <ul className="list rules">
        {RULES.map((r) => (
          <li key={r.key}>
            <label id={'rule-' + r.key}>Require {r.label.toLowerCase()}</label>
            <md-switch aria-labelledby={'rule-' + r.key} selected={draft[r.key] as boolean} onChange={(e: any) => { haptics.toggle(e.target.selected); setDraft({ ...draft, [r.key]: e.target.selected }); setMsg(''); }} />
          </li>
        ))}
      </ul>
      <div className="row">
        <md-filled-tonal-button onClick={save} disabled={!!bad}>Save</md-filled-tonal-button>
        {msg && <span role="status" className="muted small">{msg}</span>}
      </div>
    </Card>
  );
}

interface Found { type: string; granted: boolean; count: number; sources: string[]; newestMs: number | null; beyond: boolean }

/**
 * "What's in Health Connect?": for every data type, whether it is allowed, how many records this app can see and which
 * apps wrote them. When something is allowed but empty, the answer is almost always that no app is putting data into
 * Health Connect (or that the data is older than the app is allowed to read), and this says which.
 */
function HealthCheck({ info }: { info: Sdk }) {
  const [rows, setRows] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setRows([]);
    const out: Found[] = [];
    for (const type of Object.keys(TYPES)) {
      try {
        out.push({ type, ...(await health!.inspect({ type })) });
      } catch (e: any) {
        out.push({ type, granted: true, count: -1, sources: [e?.message || 'failed'], newestMs: null, beyond: false });
      }
      setRows([...out]);
    }
    setBusy(false);
  };
  const days = info.history ? 90 : 30;
  const allowed = rows?.filter((r) => r.granted && r.count >= 0) ?? [];
  const total = allowed.reduce((a, r) => a + Math.max(0, r.count), 0);
  const withData = allowed.filter((r) => r.count > 0);
  const newest = Math.max(0, ...allowed.map((r) => r.newestMs ?? 0));
  const apps = [...new Set(withData.flatMap((r) => r.sources))].map(sourceName);
  const errors = rows?.filter((r) => r.count < 0) ?? [];
  const done = rows !== null && !busy;
  return (
    <>
      <div className="row">
        <md-outlined-button onClick={() => { haptics.step(); void run(); }} disabled={busy}>
          {busy ? 'Checking…' : "What's in Health Connect?"}
        </md-outlined-button>
      </div>
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th className="num">Last {days} days</th><th>From</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.type}>
                  <td>{METRICS[r.type]?.label ?? r.type}</td>
                  <td className="num">{!r.granted ? 'not allowed' : r.count < 0 ? 'error' : r.count}</td>
                  <td className="muted small">
                    {!r.granted ? '' : r.count < 0 ? r.sources[0] : r.count > 0 ? r.sources.map(sourceName).join(', ') : r.beyond && r.newestMs ? `newest ${new Date(r.newestMs).toLocaleDateString()} (older than read)` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {done && total > 0 && <p className="small">Found {total.toLocaleString()} records from {apps.join(', ') || 'your apps'}.</p>}
      {done && errors.length > 0 && (
        <Banner icon="warn" tone="error">
          Health Connect refused {errors.length} of the reads. If you have just allowed access, close the app completely, open it again and re-run this check; Health Connect only lets an app read while it is on screen.
        </Banner>
      )}
      {done && errors.length === 0 && total === 0 && allowed.length > 0 && (
        <Banner icon="warn">
          Everything is allowed, but Health Connect has no records for these in the last {days} days. This app can only read what other apps put into Health Connect.
          {newest > 0 ? ` The newest record is from ${new Date(newest).toLocaleDateString()}, which is older than the app reads${info.history ? '' : ' (allow "Past data" to read further back)'}.` : ''}
          {' '}Open the app that tracks your health (Fitbit, Samsung Health, Garmin Connect, Google Fit…) and turn on its Health Connect sync, then refresh here.
          <div className="row"><md-filled-tonal-button onClick={() => void health?.openHealthConnect()}>Open Health Connect</md-filled-tonal-button></div>
        </Banner>
      )}
      {done && errors.length === 0 && allowed.length < Object.keys(TYPES).length && <p className="small muted">{Object.keys(TYPES).length - allowed.length} types aren't allowed. Tap Allow access above, and switch everything on.</p>}
      {done && !info.history && <p className="small muted">"Past data" isn't allowed, so only the last 30 days can be read.</p>}
    </>
  );
}

/** Android only: the installed version, whether GitHub has a newer one, and the button that installs it. */
function AppUpdates() {
  const updates = useUpdates();
  const available = updateAvailable(updates);
  const busy = updates.status !== 'idle';
  // The server is updated by hand, so it can be on another version than the app. Only matters when there is a server.
  const [server, setServer] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (isLocal()) return;
    let live = true;
    void serverVersion().then((v) => live && setServer(v));
    return () => {
      live = false;
    };
  }, [updates.checkedAt]);
  const match = server && updates.current ? (server === updates.current ? 'same' : isNewer(server, updates.current) ? 'app-older' : 'server-older') : null;
  return (
    <Card>
      <h2 className="md-typescale-title-medium">App updates</h2>
      <p className="muted">
        {updates.current ? `You have version ${updates.current}.` : 'Checking which version you have…'}{' '}
        {available ? `Version ${updates.latest} is available.` : updates.latest && !updates.error ? "That's the latest." : ''}
      </p>
      {match === 'same' && <Banner icon="check">App and server match (version {server}).</Banner>}
      {match === 'app-older' && <Banner icon="warn">Mismatch: the server is on version {server}, newer than this app ({updates.current}). Update the app.</Banner>}
      {match === 'server-older' && <Banner icon="warn">Mismatch: this app is {updates.current}, but the server is still on {server}. Update the server to get everything working.</Banner>}
      {server === null && !isLocal() && updates.current && <p className="muted small">Can't reach the server to compare versions.</p>}
      {updates.error && <Banner icon="warn" tone="error">{updates.error}</Banner>}
      {updates.askedPermission && <Banner icon="check">Allow HealthConnector to install updates on the screen that just opened, come back, and tap the button again.</Banner>}
      <div className="row">
        {available && (
          <md-filled-button onClick={() => { haptics.step(); void installUpdate(); }} disabled={busy}>
            <Icon name="download" size={18} />{' '}
            {updates.status === 'downloading' ? (updates.progress != null ? `Downloading… ${Math.round(updates.progress * 100)}%` : 'Downloading…') : `Update to ${updates.latest}`}
          </md-filled-button>
        )}
        <md-filled-tonal-button onClick={() => { haptics.step(); void checkForUpdate(true); }} disabled={busy}>
          <Icon name="sync" size={18} /> {updates.status === 'checking' ? 'Checking…' : 'Check for updates'}
        </md-filled-tonal-button>
      </div>
    </Card>
  );
}

/** How to add home screen widgets, and how many there are. */
function Widgets() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    widgets?.count().then((r) => setCount(r.count)).catch(() => {});
  }, []);
  if (!widgets) return null;
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Home screen widgets</h2>
      <p className="muted">
        Press and hold an empty spot on your home screen, choose <strong>Widgets</strong>, then <strong>HealthConnector</strong>. Each widget shows one number or chart (last night's sleep, today's steps, your weight…), and you can add as many as you like. Press and hold a widget to change it.
      </p>
      {count !== null && <p className="small">{count === 0 ? 'None on your home screen yet.' : `${count} on your home screen.`}</p>}
      {count !== null && count > 0 && (
        <div className="row">
          <md-filled-tonal-button onClick={() => { haptics.step(); void refreshWidgets(); }}>
            <Icon name="sync" size={18} /> Refresh widgets
          </md-filled-tonal-button>
        </div>
      )}
    </Card>
  );
}

/** Vibration feedback for the pull-down sync (only where the device can vibrate). */
function Feedback() {
  const [on, setOn] = useState(hapticsEnabled());
  if (!hapticsAvailable()) return null;
  return (
    <Card>
      <h2 className="md-typescale-title-medium">Feedback</h2>
      <ul className="list rules">
        <li>
          <label id="haptics-label">Vibrate when syncing</label>
          <md-switch aria-labelledby="haptics-label" selected={on} onChange={(e: any) => { setOn(e.target.selected); setHapticsEnabled(e.target.selected); haptics.toggle(e.target.selected); }} />
        </li>
      </ul>
    </Card>
  );
}

/** On-device mode: what's stored here, and the way to a server. */
function LocalCard() {
  const [msg, setMsg] = useState('');
  return (
    <Card>
      <h2 className="md-typescale-title-medium">On this phone</h2>
      <p className="muted">There's no server: the app reads Health Connect and keeps a copy of your data on this phone. Nothing leaves it.</p>
      <div className="row">
        <md-filled-tonal-button onClick={() => window.dispatchEvent(new Event('hc:connect-server'))}>Connect to a server</md-filled-tonal-button>
        <md-text-button onClick={async () => { if (confirm('Delete the copy of your data kept on this phone? Health Connect itself is not touched, and the app reads it again next time.')) { await clearLocalData(); setMsg('Deleted'); } }}>Delete data kept here</md-text-button>
      </div>
      {msg && <p role="status" className="muted small">{msg}</p>}
    </Card>
  );
}

export function Settings({ me }: { me: Me }) {
  const units = useUnits();
  const local = isLocal();
  return (
    <div className="grid">
      {local ? <LocalCard /> : <Account me={me} />}
      <Card>
        <h2 className="md-typescale-title-medium">Units</h2>
        <div className="rangebar" role="group" aria-label="Units">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} className={'seg' + (u === units ? ' on' : '')} aria-pressed={u === units} onClick={() => { if (u !== units) haptics.step(); setUnits(u); }}>
              {u === units && <Icon name="check" size={16} />}{u === 'metric' ? 'Metric (kg, km)' : 'Imperial (lb, mi)'}
            </button>
          ))}
        </div>
      </Card>
      {isNative && health && <PhoneSync />}
      {isNative && <AppUpdates />}
      {isNative && <Widgets />}
      {isNative && <Feedback />}
      {isNative && !local && <ServerCard />}
      {!local && <Devices />}
      {!local && me.is_admin && <PasswordRules />}
      {!local && me.is_admin && <Users meId={me.id} />}
      {!isNative && <Banner icon="phone">The Android app shows this same dashboard and sends your Health Connect data to this server.</Banner>}
    </div>
  );
}

