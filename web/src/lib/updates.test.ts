import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pretend to be the Android app, with version 1.2.0 installed.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ canInstall: async () => ({ allowed: true }), openInstallSettings: async () => {}, install: async () => {}, addListener: async () => ({ remove() {} }) }),
}));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.2.0' }) } }));

import { checkForUpdate, getUpdateState, isNewer, resetUpdatesForTests, updateAvailable, type UpdateState } from './updates';

const release = (tag: string, assets = [{ name: 'healthconnector.apk', url: 'https://api.github.com/repos/x/y/releases/assets/1' }]) =>
  ({ ok: true, status: 200, json: async () => ({ tag_name: tag, body: 'Notes', assets }) }) as Response;

const check = (force = true) => checkForUpdate(force);

describe('isNewer', () => {
  it('compares number by number, not as text', () => {
    expect(isNewer('1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('1.9.3', '1.10.0')).toBe(false);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
  });
  it('treats the same version, and a missing part, as not newer', () => {
    expect(isNewer('1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.2', '1.2.0')).toBe(false);
    expect(isNewer('v1.2.1', '1.2.0')).toBe(true);
  });
});

describe('updateAvailable', () => {
  const base: UpdateState = { current: '1.2.0', latest: '1.3.0', notes: '', assetUrl: 'https://x', status: 'idle', progress: null, error: null, checkedAt: null, askedPermission: false };
  it('needs a newer version and an APK to install', () => {
    expect(updateAvailable(base)).toBe(true);
    expect(updateAvailable({ ...base, latest: '1.2.0' })).toBe(false);
    expect(updateAvailable({ ...base, assetUrl: null })).toBe(false);
    expect(updateAvailable({ ...base, current: null })).toBe(false);
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    resetUpdatesForTests();
    vi.restoreAllMocks();
  });

  const read = getUpdateState;

  it('finds a newer release and its APK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => release('v1.3.0')));
    await check();
    const s = read();
    expect(s.latest).toBe('1.3.0');
    expect(s.current).toBe('1.2.0');
    expect(s.assetUrl).toContain('releases/assets');
    expect(updateAvailable(s)).toBe(true);
  });

  it('says so when the installed version is the latest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => release('v1.2.0')));
    await check();
    expect(updateAvailable(read())).toBe(false);
  });

  it('ignores a release with no APK attached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => release('v9.0.0', [])));
    await check();
    expect(updateAvailable(read())).toBe(false);
  });

  it('explains a missing release and a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response));
    await check();
    expect(read().error).toBe('No release found.');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await check();
    expect(read().error).toContain('reach GitHub');
  });

  it('asks GitHub at most once every five minutes unless told to', async () => {
    const f = vi.fn(async () => release('v1.2.0'));
    vi.stubGlobal('fetch', f);
    await check(true);
    await check(false);
    await check(false);
    expect(f).toHaveBeenCalledTimes(1);
    await check(true); // the button in Settings
    expect(f).toHaveBeenCalledTimes(2);
  });
});
