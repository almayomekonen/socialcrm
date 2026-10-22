// @vitest-environment jsdom
/**
 * The connect-attempt telemetry carries an attempt id on every failure, and a
 * Meta CANCEL arriving after that failure is reported once, joined by that id —
 * never to a live, newer or successful attempt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ events: [] as { event: string; props?: Record<string, unknown> }[] }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async (event: string, props?: Record<string, unknown>) => {
    h.events.push({ event, props })
  }),
}))

async function page() {
  vi.resetModules()
  return import('@/lib/connections/connectAttemptTelemetry')
}
const failures = () => h.events.filter((e) => e.event === 'whatsapp_connect_failed')
const details = () => h.events.filter((e) => e.event === 'whatsapp_connect_cancel_detail')
const lateCancel = { errorReported: false, step: 'PHONE_NUMBER_SETUP' as const, errorId: '524126', sessionId: 'sessA1' }

beforeEach(() => {
  h.events = []
  sessionStorage.clear()
})

describe('attempt id and Meta session id on the failure', () => {
  it('a failure carries an attempt id and the in-window CANCEL ids', async () => {
    const t = await page()
    t.beginConnectAttempt().finish({ ok: false, error: 'cancelled', cancel: { errorReported: false, step: 'PERMISSIONS', sessionId: 'sessP' } })
    expect(failures()).toHaveLength(1)
    const p = failures()[0].props!
    expect(p).toMatchObject({ reason: 'cancelled', step: 'PERMISSIONS', metaSessionId: 'sessP' })
    expect(typeof p.attemptId).toBe('string')
  })
})

describe('late CANCEL', () => {
  it('after a timeout: reported once, joined to the failure by attempt id', async () => {
    const t = await page()
    t.beginConnectAttempt().finish({ ok: false, error: 'sdk', reason: 'timeout' })
    t.reportLateCancel(lateCancel)
    t.reportLateCancel(lateCancel) // a duplicate message
    expect(details()).toHaveLength(1)
    expect(details()[0].props).toEqual({ attemptId: failures()[0].props!.attemptId, step: 'PHONE_NUMBER_SETUP', metaErrorId: '524126', metaSessionId: 'sessA1' })
  })

  it('while an attempt is live it is not reported here (the gate owns it)', async () => {
    const t = await page()
    t.beginConnectAttempt()
    t.reportLateCancel(lateCancel)
    expect(details()).toHaveLength(0)
  })

  it('after a success it is ignored', async () => {
    const t = await page()
    t.beginConnectAttempt().finish({ ok: true })
    t.reportLateCancel(lateCancel)
    expect(details()).toHaveLength(0)
  })

  it('overlapping attempts: a newer attempt closes the older; an out-of-order finish of the older changes nothing', async () => {
    const t = await page()
    const a = t.beginConnectAttempt()
    a.finish({ ok: false, error: 'sdk', reason: 'timeout' })
    const b = t.beginConnectAttempt() // a new popup is open
    t.reportLateCancel(lateCancel) // could be A's or B's: B is live, so nothing is attributed
    expect(details()).toHaveLength(0)
    a.finish({ ok: false, error: 'cancelled' }) // stale settle of A
    t.reportLateCancel(lateCancel)
    expect(details()).toHaveLength(0)
    b.finish({ ok: false, error: 'cancelled' })
    t.reportLateCancel(lateCancel)
    expect(details()).toHaveLength(1)
    const bId = failures().at(-1)!.props!.attemptId
    expect(details()[0].props!.attemptId).toBe(bId)
    expect(details()[0].props!.attemptId).not.toBe(failures()[0].props!.attemptId)
  })

  it('after a server-side failure (no client failure event) it is ignored, so no detail is orphaned', async () => {
    const t = await page()
    t.beginConnectAttempt().finish({ ok: false, error: 'server' })
    t.reportLateCancel(lateCancel)
    expect(failures()).toHaveLength(0)
    expect(details()).toHaveLength(0)
  })

  it('a CANCEL with no ids sends nothing', async () => {
    const t = await page()
    t.beginConnectAttempt().finish({ ok: false, error: 'sdk', reason: 'timeout' })
    t.reportLateCancel({ errorReported: false })
    expect(details()).toHaveLength(0)
  })
})
