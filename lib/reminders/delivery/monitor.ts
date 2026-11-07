import { platformExposure } from '@/db/ownerPersonalReminders/exposure'
import { readSendControls, recordMonitorHeartbeat, tripKillSwitch } from '@/db/ownerPersonalReminders/controls'
import { billingMonth, isValidTimezone } from './period'

/**
 * The independent exposure monitor (architecture v1.5 §2, v1.6 §3). It runs on
 * EVERY reminder cron call, whether or not anything is due and whether or not
 * sending is enabled, so it never depends on a reminder request arriving.
 *
 *   - measures platform exposure for the current Meta billing month, in the
 *     billing timezone. Without a valid timezone it cannot, and says so;
 *   - writes the heartbeat ONLY after a successful measurement, so a failing
 *     monitor leaves it stale and the send gate refuses;
 *   - at or over the emergency limit (when one is configured) trips the
 *     reminder kill switch. The trip is sticky until a person resets it, and
 *     only the first trip logs EMERGENCY;
 *   - 700 (or whatever is configured) stops PERSONAL REMINDERS only. Other
 *     senders on the platform number are not stopped by this; that needs the
 *     shared ledger (F2). For them it is an operator alert.
 *
 * Log lines carry counts and codes only.
 */

export type MonitorResult = { exposure: number | null; tripped: boolean; state: 'ok' | 'unconfigured' | 'error' }

export async function runMonitor(nowMs: number): Promise<MonitorResult> {
  const c = await readSendControls()
  if (!c || !isValidTimezone(c.billingTimezone)) {
    console.warn('[personal-reminders] monitor unconfigured')
    return { exposure: null, tripped: !!c?.trippedAt, state: 'unconfigured' }
  }
  let exposure: number
  try {
    const month = billingMonth(nowMs, c.billingTimezone)
    exposure = await platformExposure(month.startMs, month.endMs)
  } catch (err) {
    console.error('[personal-reminders] monitor error', { code: (err as { code?: string })?.code ?? 'unknown' })
    return { exposure: null, tripped: !!c.trippedAt, state: 'error' }
  }
  let tripped = !!c.trippedAt
  if (c.serviceEmergencyLimit !== null && exposure >= c.serviceEmergencyLimit) {
    if (await tripKillSwitch('service_month_emergency', new Date(nowMs))) {
      console.error('[platform-wa-cost] EMERGENCY', { exposure, limit: c.serviceEmergencyLimit })
    }
    tripped = true
  } else if (c.serviceSoftLimit !== null && exposure >= c.serviceSoftLimit) {
    console.warn('[platform-wa-cost] over soft limit', { exposure, limit: c.serviceSoftLimit })
  }
  await recordMonitorHeartbeat(new Date(nowMs))
  console.log('[personal-reminders] monitor ok', { exposure, tripped })
  return { exposure, tripped, state: 'ok' }
}
