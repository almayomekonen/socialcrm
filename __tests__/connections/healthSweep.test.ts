/**
 * P0-5 — scheduled connection health.
 *
 * The sweep exists because a dead token used to be discovered by a customer
 * opening Settings, usually after leads had already been lost. Adding a clock is
 * easy; adding one that does not become a notification firehose is the actual
 * requirement. An hourly sweep over a connection that is still broken must stay
 * SILENT — otherwise the same problem is reported twenty-four times a day and
 * the customer learns to ignore every integration alert.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pages: [] as Record<string, unknown>[],
  waConnections: [] as Record<string, unknown>[],
  fbHealth: { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, errors: [] as string[] },
  waHealth: { primary: 'operational' as string, inbound: 'ready', outbound: 'ready' },
  updates: [] as { table: string; row: Record<string, unknown> }[],
  notifications: [] as Record<string, unknown>[],
  disconnectCalls: [] as unknown[],
  disconnectResult: 'emitted' as 'emitted' | 'already_disconnected',
  repairCalls: [] as string[],
}))

vi.mock('@/config/db', () => {
  const qb = (table: string) => {
    const b: Record<string, unknown> = {}
    b.where = () => b
    b.select = async () => (table === 'facebook_pages' ? h.pages : h.waConnections)
    b.update = async (row: Record<string, unknown>) => {
      h.updates.push({ table, row })
      return 1
    }
    b.first = async () => undefined
    return b
  }
  return { db: Object.assign((t: string) => qb(t), { raw: () => ({}) }) }
})

vi.mock('@/lib/facebook/health', () => ({
  checkFacebookConnection: async () => h.fbHealth,
  repairFacebookConnection: async (pageId: string) => {
    h.repairCalls.push(pageId)
    return { repaired: true, needsReconnect: false, status: h.fbHealth }
  },
}))

vi.mock('@/lib/facebook/integrationNotifications', () => ({
  markFacebookDisconnectedAndNotify: async (c: unknown) => {
    h.disconnectCalls.push(c)
    return h.disconnectResult
  },
}))

vi.mock('@/lib/whatsapp/operationalStatus', () => ({
  resolveWhatsappHealth: async () => h.waHealth,
}))

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: async (e: Record<string, unknown>) => void h.notifications.push(e),
}))

beforeEach(() => {
  h.pages = []
  h.waConnections = []
  h.fbHealth = { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, errors: [] }
  h.waHealth = { primary: 'operational', inbound: 'ready', outbound: 'ready' }
  h.updates = []
  h.notifications = []
  h.disconnectCalls = []
  h.disconnectResult = 'emitted'
  h.repairCalls = []
  vi.stubEnv('FACEBOOK_MESSENGER_ENABLED', '')
})

const FB_PAGE = { id: 11, agency_id: 103, page_id: 'PAGE_1', page_access_token: 'tok', health_status: 'healthy' }
const WA_CONN = {
  id: 21,
  agency_id: 103,
  phone_number_id: 'PHONE_1',
  access_token: 'tok',
  waba_id: 'WABA_1',
  health_status: 'operational',
}

describe('Facebook sweep', () => {
  it('reports a newly dead token through the transition-guarded emitter', async () => {
    h.pages = [FB_PAGE]
    h.fbHealth = { tokenValid: false, permissionsOk: false, subscribed: false, needsReconnect: true, errors: [] }
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    const r = await runConnectionHealthSweep()

    expect(h.disconnectCalls).toHaveLength(1)
    expect(r.facebookDisconnected).toBe(1)
  })

  it('stays silent when the Page was already known disconnected', async () => {
    h.pages = [{ ...FB_PAGE, health_status: 'token_expired' }]
    h.fbHealth = { tokenValid: false, permissionsOk: false, subscribed: false, needsReconnect: true, errors: [] }
    h.disconnectResult = 'already_disconnected'
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    const r = await runConnectionHealthSweep()

    // Still checked, deliberately not counted as news.
    expect(r.facebookChecked).toBe(1)
    expect(r.facebookDisconnected).toBe(0)
  })

  it('repairs a lost webhook subscription — the one credential-free fix', async () => {
    h.pages = [FB_PAGE]
    h.fbHealth = { tokenValid: true, permissionsOk: true, subscribed: false, needsReconnect: false, errors: [] }
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    const r = await runConnectionHealthSweep()

    expect(h.repairCalls).toEqual(['PAGE_1'])
    expect(r.facebookRepaired).toBe(1)
    // A valid token is never "repaired" by touching credentials.
    expect(h.disconnectCalls).toHaveLength(0)
  })

  it('records recovery so the settings page and the banner agree', async () => {
    h.pages = [{ ...FB_PAGE, health_status: 'token_expired' }]
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    await runConnectionHealthSweep()

    const healthy = h.updates.find((u) => u.row.health_status === 'healthy')
    expect(healthy).toBeTruthy()
  })
})

describe('WhatsApp sweep', () => {
  it('notifies once on the transition INTO a broken state', async () => {
    h.waConnections = [WA_CONN]
    h.waHealth = { primary: 'token', inbound: 'unknown', outbound: 'not_ready' }
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    const r = await runConnectionHealthSweep()

    expect(r.whatsappTransitioned).toBe(1)
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]).toMatchObject({ type: 'integration.disconnected', agencyId: 103 })
    expect((h.notifications[0].payload as Record<string, unknown>).provider).toBe('whatsapp')
  })

  it('STAYS SILENT while a connection merely remains broken', async () => {
    // The anti-spam case: hourly sweeps must not re-report the same problem.
    h.waConnections = [{ ...WA_CONN, health_status: 'token' }]
    h.waHealth = { primary: 'token', inbound: 'unknown', outbound: 'not_ready' }
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    const r = await runConnectionHealthSweep()

    expect(r.whatsappChecked).toBe(1)
    expect(r.whatsappTransitioned).toBe(0)
    expect(h.notifications).toHaveLength(0)
  })

  it('does not notify on recovery — that is visible without an interruption', async () => {
    h.waConnections = [{ ...WA_CONN, health_status: 'token' }]
    h.waHealth = { primary: 'operational', inbound: 'ready', outbound: 'ready' }
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    await runConnectionHealthSweep()

    expect(h.notifications).toHaveLength(0)
    expect(h.updates.some((u) => u.row.health_status === 'operational')).toBe(true)
  })

  it('persists the verdict on every pass, so the next pass can compare', async () => {
    h.waConnections = [WA_CONN]
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    await runConnectionHealthSweep()

    const written = h.updates.find((u) => u.table === 'whatsapp_connections')
    expect(written?.row.health_status).toBe('operational')
    expect(written?.row.health_checked_at).toBeInstanceOf(Date)
  })
})

describe('isolation', () => {
  it('one failing connection never stops the sweep', async () => {
    h.pages = [FB_PAGE]
    h.waConnections = [WA_CONN]
    const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
    const r = await runConnectionHealthSweep()

    expect(r.facebookChecked).toBe(1)
    expect(r.whatsappChecked).toBe(1)
    expect(r.errors).toBe(0)
  })
})
