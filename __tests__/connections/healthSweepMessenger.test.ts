/**
 * Scheduled connection health — the Messenger half.
 *
 * Incident 2026-09-14: Messenger was rolled out and granted, the Page was
 * subscribed to leadgen,feed only, and the hourly sweep called it healthy at
 * 23:00Z and 08:00Z without changing anything. Separately, the Meta app's own
 * Page subscription lacked the Messenger fields, which no Page-level repair
 * can fix and no customer can see.
 *
 * Split from healthSweep.test.ts (Lead Ads, WhatsApp, notifications); same mocks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type FbHealth = {
  tokenValid: boolean
  permissionsOk: boolean
  subscribed: boolean
  needsReconnect: boolean
  errors: string[]
  missingFields?: string[]
}

const h = vi.hoisted(() => ({
  pages: [] as Record<string, unknown>[],
  fbHealth: null as unknown as FbHealth,
  expectedFields: [] as (readonly string[])[],
  repairCalls: [] as string[],
  updates: [] as { table: string; row: Record<string, unknown> }[],
  disconnectCalls: [] as unknown[],
  notifications: [] as unknown[],
  appMissing: null as string[] | null,
  appSignalsMissing: [] as string[],
  order: [] as string[],
}))

vi.mock('@/config/db', () => {
  const qb = (table: string) => {
    const b: Record<string, unknown> = {}
    b.where = () => b
    b.select = async () => {
      if (table === 'whatsapp_connections') h.order.push('whatsapp')
      return table === 'facebook_pages' ? h.pages : []
    }
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
  checkFacebookConnection: async (_pageId: string, _token: string, expected: readonly string[]) => {
    h.expectedFields.push(expected)
    return h.fbHealth
  },
  repairFacebookConnection: async (pageId: string) => {
    h.repairCalls.push(pageId)
    return { repaired: true, needsReconnect: false, status: h.fbHealth }
  },
}))

vi.mock('@/lib/facebook/appWebhookSubscription', () => ({
  appMessengerSubscriptionGaps: async () => {
    h.order.push('app-subscription')
    return h.appMissing === null ? null : { core: h.appMissing, signals: h.appSignalsMissing }
  },
}))

vi.mock('@/lib/facebook/integrationNotifications', () => ({
  markFacebookDisconnectedAndNotify: async (c: unknown) => {
    h.disconnectCalls.push(c)
    return 'emitted'
  },
}))
vi.mock('@/lib/whatsapp/operationalStatus', () => ({
  resolveWhatsappHealth: async () => ({ primary: 'operational', inbound: 'ready', outbound: 'ready' }),
}))
vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: async (e: unknown) => void h.notifications.push(e),
}))

const FB_PAGE = { id: 11, agency_id: 103, page_id: 'PAGE_1', page_access_token: 'tok', health_status: 'healthy' }
const MESSAGING = JSON.stringify(['pages_messaging', 'leads_retrieval'])

beforeEach(() => {
  h.pages = []
  h.fbHealth = { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, errors: [], missingFields: [] }
  h.expectedFields = []
  h.repairCalls = []
  h.updates = []
  h.disconnectCalls = []
  h.notifications = []
  h.appMissing = null
  h.order = []
  vi.stubEnv('FACEBOOK_MESSENGER_ENABLED', '1')
  vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', '103')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function sweep() {
  const { runConnectionHealthSweep } = await import('@/lib/connections/healthSweep')
  return runConnectionHealthSweep()
}

describe('Page-level Messenger fields', () => {
  it('checks each Page against its OWN field set — Messenger fields once granted and rolled out', async () => {
    h.pages = [
      { ...FB_PAGE, granted_scopes: MESSAGING },
      { ...FB_PAGE, id: 12, agency_id: 64, page_id: 'PAGE_2', granted_scopes: MESSAGING },
    ]
    await sweep()
    expect(h.expectedFields).toEqual([
      [
        'leadgen',
        'feed',
        'messages',
        'message_echoes',
        // Enhancements: receipts, postbacks, referrals, reactions.
        'message_deliveries',
        'message_reads',
        'messaging_postbacks',
        'messaging_referrals',
        'message_reactions',
      ],
      // Agency 64 is outside the Messenger rollout: Lead Ads and comments only.
      ['leadgen', 'feed'],
    ])
  })

  it('subscribes a healthy Page to the Messenger fields it is missing, and still records the check', async () => {
    h.pages = [{ ...FB_PAGE, granted_scopes: MESSAGING }]
    h.fbHealth = { ...h.fbHealth, missingFields: ['messages', 'message_echoes'] }
    const r = await sweep()

    expect(h.repairCalls).toEqual(['PAGE_1'])
    expect(r.facebookRepaired).toBe(1)
    expect(h.disconnectCalls).toHaveLength(0)
    expect(h.updates.some((u) => u.table === 'facebook_pages' && u.row.health_checked_at instanceof Date)).toBe(true)
  })

  it('does not re-subscribe a Page that is missing nothing', async () => {
    h.pages = [{ ...FB_PAGE, granted_scopes: MESSAGING }]
    const r = await sweep()
    expect(h.repairCalls).toEqual([])
    expect(r.facebookRepaired).toBe(0)
  })
})

describe('App-level Messenger subscription (Meta dashboard)', () => {
  it('a missing ENHANCEMENT field is a warning, not an error — messaging still works', async () => {
    h.appMissing = []
    h.appSignalsMissing = ['message_deliveries', 'message_reads']
    h.pages = [{ ...FB_PAGE, granted_scopes: MESSAGING }]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sweep()

    // Nothing is broken, so nothing is logged as broken.
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining('missing Messenger fields'), expect.anything())
    expect(warns).toHaveBeenCalledWith(
      expect.stringContaining('not subscribed to Messenger signal fields'),
      expect.objectContaining({ missing: ['message_deliveries', 'message_reads'] }),
    )
    errors.mockRestore()
    warns.mockRestore()
  })

  it('logs for operators once per pass when the app lacks the Messenger fields — after WhatsApp', async () => {
    h.appMissing = ['messages', 'message_echoes']
    h.pages = [
      { ...FB_PAGE, granted_scopes: MESSAGING },
      { ...FB_PAGE, id: 13, page_id: 'PAGE_3', granted_scopes: MESSAGING },
    ]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await sweep()

    expect(h.order).toEqual(['whatsapp', 'app-subscription'])
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('missing Messenger fields'), {
      missing: ['messages', 'message_echoes'],
    })
    // Not a customer problem: nothing disconnected, nothing notified, result shape unchanged.
    expect(r.facebookDisconnected).toBe(0)
    expect(h.notifications).toHaveLength(0)
    expect(Object.keys(r).sort()).toEqual(
      ['errors', 'facebookChecked', 'facebookDisconnected', 'facebookRepaired', 'whatsappChecked', 'whatsappTransitioned'].sort(),
    )
  })

  it('does not ask about the app subscription when no Page is due Messenger', async () => {
    vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', '999')
    h.pages = [{ ...FB_PAGE, granted_scopes: MESSAGING }]
    await sweep()
    expect(h.order).not.toContain('app-subscription')
  })

  it('stays silent when the app subscription is complete or unreadable', async () => {
    h.pages = [{ ...FB_PAGE, granted_scopes: MESSAGING }]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const answer of [[], null]) {
      h.appMissing = answer
      await sweep()
    }
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining('missing Messenger fields'), expect.anything())
  })
})
