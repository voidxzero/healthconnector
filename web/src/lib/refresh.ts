import { isLocal, isNative } from './api';
import { health } from './health';
import { localRefresh } from './localsync';
import { ensurePhoneSync } from './session';

/** Anything that finished syncing calls this; the corner tick listens. */
export const markSynced = () => window.dispatchEvent(new Event('hc:synced'));

/**
 * What swiping down does. In the Android app it syncs Health Connect (to the server, or into
 * the phone's own copy in on-device mode); in a browser it just reloads. Returns a short message to show.
 */
export async function refreshAll(): Promise<string> {
  if (isLocal()) {
    const n = await localRefresh(true);
    return n === null ? 'Allow Health Connect access in Settings first' : `Read ${n} records`;
  }
  if (isNative && health) {
    try {
      await ensurePhoneSync();
      const r = await health.syncNow();
      return r.sent === 0 ? 'Nothing new to send' : `Synced ${r.sent} records`;
    } finally {
      window.dispatchEvent(new Event('hc:data-changed')); // show whatever the server has now, even if the sync failed
    }
  }
  window.dispatchEvent(new Event('hc:data-changed'));
  return 'Refreshed';
}
