import { afterEach, describe, expect, it } from 'vitest'
import {
  getInboxRefreshIntervalMs,
  isInboxDeltaSyncEnabled,
  shouldMountInboxRefreshPoller,
} from '@/lib/flags/inboxFlags'

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const prev: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key]
    const next = vars[key]
    if (next === undefined) delete process.env[key]
    else process.env[key] = next
  }
  try {
    run()
  } finally {
    for (const key of Object.keys(vars)) {
      const v = prev[key]
      if (v === undefined) delete process.env[key]
      else process.env[key] = v
    }
  }
}

afterEach(() => {
  delete process.env.INBOX_DELTA_SYNC
  delete process.env.INBOX_REFRESH_POLLER
})

describe('inbox flags (Wave A1)', () => {
  it('keeps delta sync disabled by default', () => {
    withEnv({ INBOX_DELTA_SYNC: undefined }, () => {
      expect(isInboxDeltaSyncEnabled()).toBe(false)
    })
    withEnv({ INBOX_DELTA_SYNC: 'false' }, () => {
      expect(isInboxDeltaSyncEnabled()).toBe(false)
    })
  })

  it('enables delta only for true/1', () => {
    withEnv({ INBOX_DELTA_SYNC: 'true' }, () => {
      expect(isInboxDeltaSyncEnabled()).toBe(true)
    })
    withEnv({ INBOX_DELTA_SYNC: '1' }, () => {
      expect(isInboxDeltaSyncEnabled()).toBe(true)
    })
  })

  describe('refresh interval matrix', () => {
    it('delta OFF → 5s refresh (today)', () => {
      withEnv({ INBOX_DELTA_SYNC: undefined, INBOX_REFRESH_POLLER: undefined }, () => {
        expect(getInboxRefreshIntervalMs(false)).toBe(5_000)
        expect(shouldMountInboxRefreshPoller(false)).toBe(true)
      })
    })

    it('delta ON → 60s companion refresh', () => {
      withEnv({ INBOX_REFRESH_POLLER: undefined }, () => {
        expect(getInboxRefreshIntervalMs(true)).toBe(60_000)
        expect(shouldMountInboxRefreshPoller(true)).toBe(true)
      })
    })

    it('force5s overrides to 5s even when delta ON', () => {
      withEnv({ INBOX_REFRESH_POLLER: 'force5s' }, () => {
        expect(getInboxRefreshIntervalMs(true)).toBe(5_000)
        expect(getInboxRefreshIntervalMs(false)).toBe(5_000)
      })
    })

    it('off unmounts refresh only when delta ON', () => {
      withEnv({ INBOX_REFRESH_POLLER: 'off' }, () => {
        expect(getInboxRefreshIntervalMs(true)).toBeNull()
        expect(shouldMountInboxRefreshPoller(true)).toBe(false)
        // Never leave neither path when delta is off
        expect(getInboxRefreshIntervalMs(false)).toBe(5_000)
        expect(shouldMountInboxRefreshPoller(false)).toBe(true)
      })
    })
  })

  it('never yields neither-poller when delta is off', () => {
    const escapes = [undefined, 'off', 'force5s', '5s', 'false', '0']
    for (const esc of escapes) {
      withEnv({ INBOX_REFRESH_POLLER: esc }, () => {
        expect(shouldMountInboxRefreshPoller(false)).toBe(true)
      })
    }
  })

  it('when delta ON, either sync companion (60s/5s) or sync-only (off) is active', () => {
    withEnv({ INBOX_REFRESH_POLLER: undefined }, () => {
      expect(getInboxRefreshIntervalMs(true)).toBe(60_000)
    })
    withEnv({ INBOX_REFRESH_POLLER: 'force5s' }, () => {
      expect(getInboxRefreshIntervalMs(true)).toBe(5_000)
    })
    withEnv({ INBOX_REFRESH_POLLER: 'off' }, () => {
      // Sync loop is the live path; refresh intentionally absent
      expect(getInboxRefreshIntervalMs(true)).toBeNull()
    })
  })
})
