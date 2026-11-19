import { registerPlugin } from '@capacitor/core';
import { isNative } from './api';

/** The Android side: reads Health Connect and sends it to the server. */
interface HealthConnectPlugin {
  status(): Promise<{
    /** "available", "update_required" or "unavailable" */
    sdk: string;
    /** Number of data types the user hasn't allowed yet. */
    missing: number;
    total: number;
    configured: boolean;
    lastStatus: string;
    lastSyncAt: string;
    /** Minutes between automatic syncs; 0 = only when asked. */
    intervalMinutes: number;
  }>;
  requestAccess(): Promise<{ missing: number }>;
  /** Save where and how to send data, and schedule the background sync. */
  configure(o: { url: string; backupUrl: string; instanceId: string; token: string }): Promise<void>;
  syncNow(): Promise<{ sent: number }>;
  /** How often the background sync runs, in minutes (0 = never). */
  setInterval(o: { minutes: number }): Promise<void>;
  /** On-device mode: the records a sync would send, returned to the app instead. One data type per call. */
  readRecords(o: { type: string; sinceMs: number; untilMs?: number }): Promise<{ records: any[] }>;
  /** The owner's name for this device, or its make and model. */
  deviceName(): Promise<{ name: string }>;
  openHealthConnect(): Promise<void>;
  clear(): Promise<void>;
}

const plugin = isNative ? registerPlugin<HealthConnectPlugin>('HealthConnect') : null;

export const health = plugin;
