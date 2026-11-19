import { ApiError, api, clearCache, getConn, isLocal, isNative, normalizeUrl, setConn, type Me } from './api';
import { clearLocalData } from './localsync';
import { health } from './health';

const ME_KEY = 'hc.me';

/** Who "signed in" in on-device mode. */
export const LOCAL_ME: Me = { id: 0, username: 'This phone', is_admin: false };

/** Android: use the app with no server. The phone reads Health Connect and shows it itself. */
export function enterLocal(): Me {
  setConn({ mode: 'local', serverUrl: '', backupUrl: '', useBackup: false, instanceId: '', token: '', syncTokenId: null });
  clearCache();
  return LOCAL_ME;
}

export const savedMe = (): Me | null => {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) || 'null');
  } catch {
    return null;
  }
};
const saveMe = (m: Me | null) => {
  try {
    if (m) localStorage.setItem(ME_KEY, JSON.stringify(m));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
};

/** Sign in (or create the first account), keeping what the Android app needs to stay signed in. */
export async function signIn(opts: {
  serverUrl: string; backupUrl: string; username: string; password: string; create: boolean;
}): Promise<Me> {
  if (isNative) {
    const url = normalizeUrl(opts.serverUrl);
    if (!url) throw new ApiError(0, 'Enter your server address');
    const st = await api.probe(url);
    setConn({ serverUrl: url, backupUrl: normalizeUrl(opts.backupUrl), useBackup: false, instanceId: st.instance_id, token: '', syncTokenId: null });
  }
  const r = opts.create ? await api.setup(opts.username, opts.password) : await api.login(opts.username, opts.password);
  if (isNative) {
    setConn({ token: r.token, mode: 'server' });
    await clearLocalData(); // the server will have it; don't keep a stale copy here
  }
  const me: Me = { id: r.id, username: r.username, is_admin: r.is_admin };
  saveMe(me);
  clearCache();
  // Give this phone its own sync token now, not whenever Settings is first opened.
  ensurePhoneSync().catch(() => {});
  return me;
}

export async function signOut() {
  if (isNative) {
    const id = getConn().syncTokenId;
    try {
      if (id) await api.revokeToken(id);
    } catch {
      /* the server may be unreachable; the token is just left behind */
    }
    try {
      await health?.clear();
    } catch {
      /* ignore */
    }
  }
  try {
    await api.logout();
  } catch {
    /* ignore */
  }
  if (isNative) setConn({ token: '', syncTokenId: null });
  saveMe(null);
  clearCache();
}

/** Who is signed in: asks the server, falling back to the saved copy when it can't be reached. */
export async function restore(): Promise<{ me: Me | null; needsSetup: boolean; offline: boolean }> {
  if (isLocal()) return { me: LOCAL_ME, needsSetup: false, offline: false };
  if (isNative && (!getConn().serverUrl || !getConn().token)) return { me: null, needsSetup: false, offline: false };
  try {
    if (isNative) {
      const me = await api.me();
      saveMe(me);
      ensurePhoneSync().catch(() => {}); // retries if an earlier attempt failed (no network at the time)
      return { me, needsSetup: false, offline: false };
    }
    const st = await api.status();
    saveMe(st.user);
    return { me: st.user, needsSetup: st.needs_setup, offline: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0 && savedMe()) return { me: savedMe(), needsSetup: false, offline: true };
    if (e instanceof ApiError && e.status === 401) saveMe(null);
    return { me: null, needsSetup: false, offline: false };
  }
}

/** A random id for this install, kept across sign-outs, so the server can tell "the same phone signed in again" from "another phone". */
function deviceId(): string {
  try {
    let id = localStorage.getItem('hc.deviceId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('hc.deviceId', id);
    }
    return id;
  } catch {
    return '';
  }
}

/** This device's name for the Devices list: what the owner calls it, else make and model. */
async function deviceLabel(): Promise<string> {
  try {
    const { name } = await health!.deviceName();
    if (name) return name.slice(0, 60);
  } catch {
    /* an older build of the native side: fall through */
  }
  return 'Android device';
}

/**
 * Android: give this phone its own sync token and hand it to the background sync.
 * Safe to call any time: if the token it has is still on the server it does nothing,
 * and if the server no longer knows it (database reset, token removed) it makes a new one.
 */
export async function ensurePhoneSync(): Promise<void> {
  if (!isNative || !health || isLocal()) return;
  const c = getConn();
  const label = await deviceLabel();
  if (c.syncTokenId) {
    try {
      const mine = (await api.tokens()).find((t) => t.id === c.syncTokenId);
      if (mine) {
        // Still known to the server. Keep its name in step with the device's (it may have been a generic one before).
        if (mine.label !== label) await api.renameToken(mine.id, label).catch(() => {});
        return;
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) return; // can't tell right now (offline); keep what we have
    }
  }
  const t = await api.addToken(label, deviceId());
  await health.configure({ url: normalizeUrl(c.serverUrl), backupUrl: normalizeUrl(c.backupUrl), instanceId: c.instanceId, token: t.token });
  setConn({ syncTokenId: t.id });
}
