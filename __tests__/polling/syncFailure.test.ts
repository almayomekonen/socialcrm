import { describe, expect, it, vi } from 'vitest'
import {
  INBOX_RECOVERY_MS,
  LEAD_RECOVERY_MS,
  SYNC_FAILURE_THRESHOLD,
  nextConsecutiveFailures,
  scheduleDelayAfterPoll,
  shouldShowSyncBanner,
} from '@/lib/polling/syncFailure'

describe('sync failure helpers (Wave A6)', () => {
  it('counts consecutive failures and resets on success', () => {
    expect(nextConsecutiveFailures(0, true)).toBe(1)
    expect(nextConsecutiveFailures(2, true)).toBe(3)
    expect(nextConsecutiveFailures(3, false)).toBe(0)
  })

  it('shows banner only at threshold', () => {
    expect(shouldShowSyncBanner(2)).toBe(false)
    expect(shouldShowSyncBanner(SYNC_FAILURE_THRESHOLD)).toBe(true)
    expect(shouldShowSyncBanner(5)).toBe(true)
  })

  it('uses recovery band when failed — not idle backoff', () => {
    expect(
      scheduleDelayAfterPoll({ failed: true, recoveryMs: LEAD_RECOVERY_MS, idleMs: 45_000 }),
    ).toBe(LEAD_RECOVERY_MS)
    expect(
      scheduleDelayAfterPoll({ failed: true, recoveryMs: INBOX_RECOVERY_MS, idleMs: 60_000 }),
    ).toBe(INBOX_RECOVERY_MS)
    expect(
      scheduleDelayAfterPoll({ failed: false, recoveryMs: LEAD_RECOVERY_MS, idleMs: 45_000 }),
    ).toBe(45_000)
  })

  it('locks recovery constants to blueprint', () => {
    expect(LEAD_RECOVERY_MS).toBe(15_000)
    expect(INBOX_RECOVERY_MS).toBe(3_500)
    expect(SYNC_FAILURE_THRESHOLD).toBe(3)
  })
})

describe('CrmSyncBanner a11y smoke', () => {
  it('logSyncBannerOpen warns once-shaped payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { logSyncBannerOpen } = await import('@/lib/polling/syncFailure')
    logSyncBannerOpen('leads', 3)
    expect(warn).toHaveBeenCalledWith('[crm.sync]', { source: 'leads', failures: 3 })
    warn.mockRestore()
  })
})
