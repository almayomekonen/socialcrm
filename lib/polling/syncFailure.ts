/**
 * Pure helpers for CRM poll sync-failure UX (Wave A6).
 * Errors use a fixed recovery interval and do not advance idle backoff.
 */

export const SYNC_FAILURE_THRESHOLD = 3
export const LEAD_RECOVERY_MS = 15_000
export const INBOX_RECOVERY_MS = 3_500

export type CrmSyncSource = 'leads' | 'inbox-sync' | 'awareness'

export function nextConsecutiveFailures(prev: number, failed: boolean): number {
  return failed ? prev + 1 : 0
}

export function shouldShowSyncBanner(
  failures: number,
  threshold: number = SYNC_FAILURE_THRESHOLD,
): boolean {
  return failures >= threshold
}

/** When the last tick failed, schedule the recovery band — never idle backoff. */
export function scheduleDelayAfterPoll(opts: {
  failed: boolean
  recoveryMs: number
  idleMs: number
}): number {
  return opts.failed ? opts.recoveryMs : opts.idleMs
}

export function logSyncBannerOpen(source: CrmSyncSource, failures: number): void {
  console.warn('[crm.sync]', { source, failures })
}
