import { Capacitor } from '@capacitor/core';
import { localQuery } from './localdata';

/** True inside the Android app, false in a browser. */
export const isNative = Capacitor.isNativePlatform();

export class ApiError extends Error {
  /** HTTP status, or 0 when the server couldn't be reached. */
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Me {
  id: number;
  username: string;
  is_admin: boolean;
}

export interface PasswordPolicy {
  min_length: number;
  require_upper: boolean;
  require_lower: boolean;
  require_digit: boolean;
  require_symbol: boolean;
}

export interface ServerStatus {
  app: string;
  instance_id: string;
  needs_setup: boolean;
  features: string[];
  user: Me | null;
  password_policy: PasswordPolicy;
}

/** What the Android app remembers about its server. In a browser the page's own origin is the server. */
export interface Conn {
  /** "local": no server, the phone shows its own Health Connect data. "" is an install that predates modes (a server). */
  mode: '' | 'server' | 'local';
  serverUrl: string;
  /** Optional second address for the same server, typically its home-network IP. */
  backupUrl: string;
  /** True when the backup address is the one that worked last. */
  useBackup: boolean;
  instanceId: string;
  token: string;
  /** The sync token this phone made for itself, so signing out can revoke it. */
  syncTokenId: number | null;
}

const KEY = 'hc.conn';
const EMPTY: Conn = { mode: '', serverUrl: '', backupUrl: '', useBackup: false, instanceId: '', token: '', syncTokenId: null };

let conn: Conn = load();
const listeners = new Set<() => void>();

function load(): Conn {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...EMPTY };
  }
}

export function getConn(): Conn {
  return conn;
}

export function setConn(patch: Partial<Conn>) {
  conn = { ...conn, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(conn));
  } catch {
    /* storage unavailable: the session just won't survive a restart */
  }
  listeners.forEach((l) => l());
}

export function onConnChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "192.168.1.20:8060" -> "http://192.168.1.20:8060"; "health.example.com" -> "https://health.example.com". */
export function normalizeUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    const hostPart = u.split('/')[0];
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[.*\]|[^.]+\.(local|lan|home|internal))(:\d+)?$/i.test(hostPart) || /:\d+$/.test(hostPart);
    u = (local ? 'http://' : 'https://') + u;
  }
  return u;
}

/** True in the Android app when it was set up without a server. */
export const isLocal = () => isNative && conn.mode === 'local';

function activeBase(): string {
  if (!isNative) return '';
  return normalizeUrl(conn.useBackup && conn.backupUrl ? conn.backupUrl : conn.serverUrl);
}

async function raw(base: string, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (isNative) {
    if (conn.token) headers.Authorization = `Bearer ${conn.token}`;
  } else if (init.method && init.method !== 'GET') {
    headers['X-HC'] = '1'; // the server requires this on browser writes
  }
  try {
    return await fetch(base + path, {
      method: init.method || 'GET',
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server");
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Server returned ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') msg = body.detail;
      else if (Array.isArray(body.detail)) msg = 'Check the form and try again';
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

/**
 * Every call goes through here. In the app, if the address in use can't be
 * reached, the other one is tried, but only after its /api/status reports the
 * same instance id, so the sign-in token never goes to some other device that
 * happens to sit at the same LAN address.
 */
async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  try {
    return await parse<T>(await raw(activeBase(), path, init));
  } catch (e) {
    if (!(isNative && e instanceof ApiError && e.status === 0)) throw e;
    const otherIsBackup = !conn.useBackup;
    const other = normalizeUrl(otherIsBackup ? conn.backupUrl : conn.serverUrl);
    if (!other) throw e;
    try {
      const st = await parse<ServerStatus>(await raw(other, '/api/status'));
      if (!conn.instanceId || st.instance_id !== conn.instanceId) throw e;
    } catch {
      throw e;
    }
    const out = await parse<T>(await raw(other, path, init));
    setConn({ useBackup: otherIsBackup });
    return out;
  }
}

// ---- reading, with a copy kept for when the server can't be reached

export interface Fetched<T> {
  data: T;
  /** True when this is the last copy saved on the device, because the server couldn't be reached. */
  stale: boolean;
}

const cacheKey = (path: string) => `hc.cache.${conn.instanceId || 'web'}.${path}`;

export async function get<T>(path: string): Promise<Fetched<T>> {
  if (isLocal()) {
    const data = await localQuery(path);
    if (data === undefined) throw new ApiError(404, 'Not available without a server');
    return { data: data as T, stale: false };
  }
  try {
    const data = await request<T>(path);
    try {
      localStorage.setItem(cacheKey(path), JSON.stringify(data));
    } catch {
      /* cache is best-effort */
    }
    return { data, stale: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      try {
        const hit = localStorage.getItem(cacheKey(path));
        if (hit) return { data: JSON.parse(hit) as T, stale: true };
      } catch {
        /* fall through */
      }
    }
    throw e;
  }
}

export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('hc.cache.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

const send = <T>(method: string, path: string, json?: unknown) => request<T>(path, { method, json });

export const api = {
  /** Check an address is a Health Connector server. Doesn't need to be signed in. */
  async probe(url: string): Promise<ServerStatus> {
    const st = await parse<ServerStatus>(await raw(normalizeUrl(url), '/api/status'));
    if (st.app !== 'healthconnector') throw new ApiError(0, "That address isn't a Health Connector server");
    return st;
  },
  status: () => request<ServerStatus>('/api/status'),
  setup: (username: string, password: string) =>
    send<Me & { token: string }>('POST', '/api/setup', { username, password }),
  login: (username: string, password: string) =>
    send<Me & { token: string }>('POST', '/api/login', { username, password }),
  logout: () => send<{ ok: boolean }>('POST', '/api/logout'),
  me: () => request<Me>('/api/me'),
  changePassword: (current: string, next: string) => send('POST', '/api/password', { current, new: next }),

  setPasswordPolicy: (p: PasswordPolicy) => send<PasswordPolicy>('PUT', '/api/password-policy', p),
  users: () => request<(Me & { created_at: string })[]>('/api/users'),
  addUser: (username: string, password: string, is_admin: boolean) =>
    send('POST', '/api/users', { username, password, is_admin }),
  resetPassword: (id: number, password: string) => send('POST', `/api/users/${id}/password`, { password }),
  deleteUser: (id: number) => send('DELETE', `/api/users/${id}`),

  tokens: () => request<SyncToken[]>('/api/tokens'),
  addToken: (label: string, device_id?: string) => send<{ id: number; token: string }>('POST', '/api/tokens', { label, device_id }),
  renameToken: (id: number, label: string) => send('PATCH', `/api/tokens/${id}`, { label }),
  revokeToken: (id: number) => send('DELETE', `/api/tokens/${id}`),
};

export interface SyncToken {
  id: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
}
