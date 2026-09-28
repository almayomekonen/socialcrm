// @vitest-environment jsdom
/**
 * `abandoned` must describe an attempt that really lost its page, once, and
 * never sit beside an outcome that was recorded for the same attempt.
 *
 * Three ways it could lie, each pinned here:
 *   - another tab (shared localStorage) reporting this tab's live attempt;
 *   - a second connect component on the same page mounting mid-attempt;
 *   - the same marker being reported twice.
 * The fourth — a reload after the server already finished — is decided on the
 * server; see whatsappConnectFailedClient.test.ts and connectOutcome.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ events: [] as { event: string; props?: Record<string, unknown> }[] }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async (event: string, props?: Record<string, unknown>) => {
    h.events.push({ event, props })
  }),
}))

const KEY = 'socialcrm:wa-connect-pending'

async function freshPage() {
  // A reload: module state is gone, sessionStorage (same tab) survives.
  vi.resetModules()
  return import('@/lib/connections/connectAttemptTelemetry')
}

beforeEach(() => {
  h.events = []
  sessionStorage.clear()
  localStorage.clear()
})

describe('abandoned attempts', () => {
  it('a reload during an attempt reports it once, on the reloaded page', async () => {
    const page1 = await freshPage()
    page1.beginConnectAttempt() // never finishes: the page goes away
    expect(sessionStorage.getItem(KEY)).not.toBeNull()

    const page2 = await freshPage()
    page2.reportAbandonedConnectAttempt()
    page2.reportAbandonedConnectAttempt() // a second mount on the same page
    const abandoned = h.events.filter((e) => e.props?.reason === 'abandoned')
    expect(abandoned).toHaveLength(1)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('is per tab: the marker lives in sessionStorage, never localStorage', async () => {
    const page = await freshPage()
    page.beginConnectAttempt()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).not.toBeNull()
  })

  it('a component mounting while this page’s attempt is still open reports nothing', async () => {
    const page = await freshPage()
    const attempt = page.beginConnectAttempt()
    page.reportAbandonedConnectAttempt()
    expect(h.events).toHaveLength(0)
    attempt.finish({ ok: true })
    page.reportAbandonedConnectAttempt()
    expect(h.events).toHaveLength(0)
  })

  it('a finished attempt leaves nothing to report after a reload — success or failure', async () => {
    const page = await freshPage()
    page.beginConnectAttempt().finish({ ok: true })
    page.beginConnectAttempt().finish({ ok: false, error: 'cancelled' })
    const next = await freshPage()
    next.reportAbandonedConnectAttempt()
    expect(h.events.map((e) => e.props?.reason)).toEqual(['cancelled'])
  })

  it('never reports a success as a failure', async () => {
    const page = await freshPage()
    page.beginConnectAttempt().finish({ ok: true, messagingReady: true })
    expect(h.events).toHaveLength(0)
  })
})
