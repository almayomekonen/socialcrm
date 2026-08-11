import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET /api/notifications/feed — behaviour, with every data function mocked.
 *
 * DB-free by construction (spec §22.1): the route's job is auth, gating, ordering
 * and headers, and each of those is observable through the mocks. Follows the
 * vi.hoisted + dynamic-import convention already used by
 * __tests__/whatsapp/templates/templatesGetEndpoint.test.ts.
 */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAgencyProductAccess: vi.fn(),
  readPresence: vi.fn(),
  stampPresence: vi.fn(),
  clearAwayBoundary: vi.fn(),
  countUnreadNotifications: vi.fn(),
  listNotifications: vi.fn(),
  summarizeAwayNotifications: vi.fn(),
  countUnreadConversationsForUser: vi.fn(),
}))

vi.mock('@/db/auth', () => ({ getUser: h.getUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.getAgencyProductAccess }))
vi.mock('@/db/inboxConversationReads', () => ({ countUnreadConversationsForUser: h.countUnreadConversationsForUser }))

// The presence module is partially mocked: the pure boundary rule and the
// snapshot adapter are the real implementations, because their interaction with
// the route ordering is exactly what several of these tests verify.
vi.mock('@/db/notifications/presence', async () => {
  const actual = await vi.importActual<typeof import('@/db/notifications/presence')>('@/db/notifications/presence')
  return {
    ...actual,
    readPresence: h.readPresence,
    stampPresence: h.stampPresence,
    clearAwayBoundary: h.clearAwayBoundary,
  }
})

vi.mock('@/db/notifications/feed', async () => {
  const actual = await vi.importActual<typeof import('@/db/notifications/feed')>('@/db/notifications/feed')
  return {
    ...actual,
    countUnreadNotifications: h.countUnreadNotifications,
    listNotifications: h.listNotifications,
    summarizeAwayNotifications: h.summarizeAwayNotifications,
  }
})

const routeModule = await import('@/app/api/notifications/feed/route')
const { GET } = routeModule

const USER = { id: 55, agencyId: 7 }
const NOW = new Date('2026-08-11T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

const req = (qs = '') => new Request(`https://app.test/api/notifications/feed${qs}`) as never

const ITEM = {
  id: 900,
  type: 'lead.created',
  category: 'leads',
  priority: 'medium',
  title: 'ליד חדש — דניאל כהן',
  body: null,
  entityType: 'lead',
  entityId: 42,
  deepLink: '/clients/42',
  groupCount: 1,
  createdAt: NOW.toISOString(),
  seenAt: null,
  readAt: null,
}

beforeEach(() => {
  /**
   * Only `Date` is faked, not timers: the route builds its own `new Date()` (it
   * must never accept a clock from a caller), so every relative fixture below
   * would otherwise be measured against the real wall clock. Faking the whole
   * timer set would interfere with the promise scheduling these async paths rely
   * on.
   */
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)

  for (const fn of Object.values(h)) fn.mockReset()
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
  h.getUser.mockResolvedValue(USER)
  h.getAgencyProductAccess.mockResolvedValue({ hasAccess: true })
  h.readPresence.mockResolvedValue({ lastSeenAt: minutesAgo(1), lastSeenVisible: true, awaySinceAt: null })
  h.stampPresence.mockResolvedValue(undefined)
  h.clearAwayBoundary.mockResolvedValue(undefined)
  h.countUnreadNotifications.mockResolvedValue(3)
  h.countUnreadConversationsForUser.mockResolvedValue(5)
  h.listNotifications.mockResolvedValue([ITEM])
  h.summarizeAwayNotifications.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.NOTIFICATIONS_ENABLED
  delete process.env.NOTIFICATIONS_AGENCY_ALLOWLIST
})

describe('authorization', () => {
  it('401 without a session, and nothing is read or written', async () => {
    h.getUser.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(h.readPresence).not.toHaveBeenCalled()
    expect(h.stampPresence).not.toHaveBeenCalled()
    expect(h.listNotifications).not.toHaveBeenCalled()
  })

  it('401 for a session with no agency — a userId alone is never enough', async () => {
    h.getUser.mockResolvedValue({ id: 55, agencyId: null })
    expect((await GET(req())).status).toBe(401)
    expect(h.stampPresence).not.toHaveBeenCalled()
  })

  it('403 without product access, and still nothing is written', async () => {
    h.getAgencyProductAccess.mockResolvedValue({ hasAccess: false })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(h.stampPresence).not.toHaveBeenCalled()
  })
})

describe('tenant and user scoping (§20.1)', () => {
  it('every read is scoped to the SESSION agency and user', async () => {
    await GET(req())
    const scope = { agencyId: 7, userId: 55 }
    expect(h.countUnreadNotifications).toHaveBeenCalledWith(expect.objectContaining(scope))
    expect(h.listNotifications).toHaveBeenCalledWith(expect.objectContaining(scope))
    expect(h.readPresence).toHaveBeenCalledWith(expect.objectContaining(scope))
    expect(h.stampPresence).toHaveBeenCalledWith(expect.objectContaining(scope))
    expect(h.countUnreadConversationsForUser).toHaveBeenCalledWith(7, 55)
  })

  it('a client-supplied userId/agencyId is IGNORED — not an input to any query', async () => {
    await GET(req('?userId=999&agencyId=888'))
    for (const call of h.listNotifications.mock.calls) {
      expect(call[0]).toMatchObject({ userId: 55, agencyId: 7 })
    }
    expect(h.countUnreadConversationsForUser).toHaveBeenCalledWith(7, 55)
    expect(h.countUnreadConversationsForUser).not.toHaveBeenCalledWith(888, 999)
  })
})

describe('the feature gate', () => {
  it('returns the inert shape when NOTIFICATIONS_ENABLED is off, touching nothing', async () => {
    process.env.NOTIFICATIONS_ENABLED = '0'
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ enabled: false, unreadNotificationCount: 0, whileYouWereAway: null })
    // Critically: no presence row is created for a disabled feature.
    expect(h.readPresence).not.toHaveBeenCalled()
    expect(h.stampPresence).not.toHaveBeenCalled()
  })

  it('returns the inert shape when the agency is not allowlisted', async () => {
    process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = '999'
    const res = await GET(req())
    expect((await res.json()).enabled).toBe(false)
    expect(h.stampPresence).not.toHaveBeenCalled()
  })
})

describe('the two unread counts stay separate (nav badge non-regression)', () => {
  it('reports both metrics, from their own sources, under distinct names', async () => {
    h.countUnreadNotifications.mockResolvedValue(3)
    h.countUnreadConversationsForUser.mockResolvedValue(5)
    const body = await (await GET(req())).json()

    expect(body.unreadNotificationCount).toBe(3)
    expect(body.unreadConversationCount).toBe(5)
  })

  it('the conversation count comes from the EXISTING inbox function, not a new query', async () => {
    await GET(req())
    expect(h.countUnreadConversationsForUser).toHaveBeenCalledTimes(1)
  })

  it('reports 0 conversations for OFFICE, mirroring the layout guard', async () => {
    /**
     * OFFICE never sees the inbox, so the layout passes inboxUnread 0 and the nav
     * badge has never rendered for that role. If the feed returned a real count,
     * P2.2 would hand OFFICE a badge it has never had — a nav badge regression
     * arriving by the back door.
     */
    h.getUser.mockResolvedValue({ id: 55, agencyId: 7, role: 'OFFICE' })
    const body = await (await GET(req())).json()

    expect(body.unreadConversationCount).toBe(0)
    expect(h.countUnreadConversationsForUser).not.toHaveBeenCalled()
    // The bell's own count is unaffected — OFFICE still receives notifications.
    expect(body.unreadNotificationCount).toBe(3)
  })

  it('the counts do not contaminate each other when one is zero', async () => {
    h.countUnreadNotifications.mockResolvedValue(0)
    h.countUnreadConversationsForUser.mockResolvedValue(4)
    const body = await (await GET(req())).json()
    expect(body.unreadNotificationCount).toBe(0)
    expect(body.unreadConversationCount).toBe(4)
  })
})

describe('presence stamping', () => {
  it('reads presence BEFORE stamping it', async () => {
    const order: string[] = []
    h.readPresence.mockImplementation(async () => {
      order.push('read')
      return { lastSeenAt: minutesAgo(1), lastSeenVisible: true, awaySinceAt: null }
    })
    h.stampPresence.mockImplementation(async () => {
      order.push('stamp')
    })

    await GET(req())
    expect(order).toEqual(['read', 'stamp'])
  })

  it('classifies from the PRE-stamp snapshot — polling does not make everyone online', async () => {
    // A user last seen 30 minutes ago is OFFLINE for this request, even though
    // this very request refreshes their lastSeenAt.
    h.readPresence.mockResolvedValue({ lastSeenAt: minutesAgo(30), lastSeenVisible: true, awaySinceAt: null })
    const body = await (await GET(req())).json()
    expect(body.presence).toBe('offline')
  })

  it('a missing presence row classifies OFFLINE', async () => {
    h.readPresence.mockResolvedValue({ lastSeenAt: null, lastSeenVisible: false, awaySinceAt: null })
    const body = await (await GET(req())).json()
    expect(body.presence).toBe('offline')
  })

  it('passes the tab visibility through, defaulting to visible', async () => {
    await GET(req())
    expect(h.stampPresence).toHaveBeenCalledWith(expect.objectContaining({ visible: true }))

    h.stampPresence.mockClear()
    await GET(req('?visible=0'))
    expect(h.stampPresence).toHaveBeenCalledWith(expect.objectContaining({ visible: false }))
  })
})

describe('While You Were Away', () => {
  it('is null when the user was not away — no window is even queried', async () => {
    h.readPresence.mockResolvedValue({ lastSeenAt: minutesAgo(2), lastSeenVisible: true, awaySinceAt: null })
    const body = await (await GET(req())).json()
    expect(body.whileYouWereAway).toBeNull()
    expect(h.summarizeAwayNotifications).not.toHaveBeenCalled()
  })

  it('opens a boundary at the previous lastSeenAt after a real gap', async () => {
    const previous = minutesAgo(120)
    h.readPresence.mockResolvedValue({ lastSeenAt: previous, lastSeenVisible: true, awaySinceAt: null })
    h.summarizeAwayNotifications.mockResolvedValue({
      since: previous.toISOString(),
      total: 4,
      categories: [{ category: 'leads', count: 4 }],
    })

    const body = await (await GET(req())).json()

    expect(h.summarizeAwayNotifications).toHaveBeenCalledWith(expect.objectContaining({ since: previous }))
    // The boundary is PERSISTED by the same stamp that refreshes lastSeenAt.
    expect(h.stampPresence).toHaveBeenCalledWith(expect.objectContaining({ awaySinceAt: previous }))
    expect(body.whileYouWereAway).toEqual({
      since: previous.toISOString(),
      total: 4,
      categories: [{ category: 'leads', count: 4 }],
    })
  })

  it('DOES NOT DISAPPEAR because the feed request updated presence', async () => {
    /**
     * The invariant from the P2.0 discovery, end to end.
     *
     * Second poll five seconds after returning: lastSeenAt is now fresh (this
     * request's predecessor stamped it) but awaySinceAt is still open. The window
     * must still be computed from the persisted boundary.
     */
    const boundary = minutesAgo(120)
    h.readPresence.mockResolvedValue({
      lastSeenAt: new Date(NOW.getTime() - 5_000),
      lastSeenVisible: true,
      awaySinceAt: boundary,
    })
    h.summarizeAwayNotifications.mockResolvedValue({
      since: boundary.toISOString(),
      total: 4,
      categories: [{ category: 'leads', count: 4 }],
    })

    const body = await (await GET(req())).json()

    expect(h.summarizeAwayNotifications).toHaveBeenCalledWith(expect.objectContaining({ since: boundary }))
    expect(body.whileYouWereAway?.total).toBe(4)
    expect(body.presence).toBe('online')
  })

  it('closes the boundary once the window has nothing unseen left', async () => {
    h.readPresence.mockResolvedValue({ lastSeenAt: minutesAgo(1), lastSeenVisible: true, awaySinceAt: minutesAgo(200) })
    h.summarizeAwayNotifications.mockResolvedValue(null)

    const body = await (await GET(req())).json()

    expect(body.whileYouWereAway).toBeNull()
    expect(h.clearAwayBoundary).toHaveBeenCalledWith({ agencyId: 7, userId: 55 })
  })

  it('does not write a clear when there was no boundary — a settled feed is read-only', async () => {
    h.readPresence.mockResolvedValue({ lastSeenAt: minutesAgo(1), lastSeenVisible: true, awaySinceAt: null })
    await GET(req())
    expect(h.clearAwayBoundary).not.toHaveBeenCalled()
  })
})

describe('items and pagination', () => {
  it('returns individual records, never grouped', async () => {
    const rows = [ITEM, { ...ITEM, id: 901, entityId: 43, deepLink: '/clients/43' }]
    h.listNotifications.mockResolvedValue(rows)
    const body = await (await GET(req())).json()
    expect(body.items).toHaveLength(2)
    expect(body.items.map((i: { id: number }) => i.id)).toEqual([900, 901])
  })

  it('deep links target the entity, never the notification id', async () => {
    const body = await (await GET(req())).json()
    expect(body.items[0].deepLink).toBe('/clients/42')
    expect(body.items[0].deepLink).not.toContain('900')
    expect(body.items[0].deepLink).not.toContain('notification')
  })

  it('caps a crafted limit at the server maximum', async () => {
    await GET(req('?limit=100000'))
    expect(h.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }))
  })

  it('falls back to the default limit for junk input', async () => {
    await GET(req('?limit=abc'))
    expect(h.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
  })

  it('passes a well-formed cursor through and ignores a malformed one', async () => {
    await GET(req(`?cursor=${Date.parse('2026-08-11T10:00:00Z')}_900`))
    expect(h.listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { createdAt: '2026-08-11T10:00:00.000Z', id: 900 } }),
    )

    h.listNotifications.mockClear()
    await GET(req('?cursor=garbage'))
    expect(h.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ cursor: null }))
  })
})

describe('the response is never cacheable', () => {
  it('does NOT use the `dynamic` segment config — the build rejects it under cacheComponents', () => {
    /**
     * Next 16 + `cacheComponents: true` fails the build with:
     *   Route segment config "dynamic" is not compatible with
     *   `nextConfig.cacheComponents`. Please remove it.
     *
     * So the correct idiom here is the absence of the config, not its presence.
     * This test pins that, because "add force-dynamic to be safe" is the obvious
     * wrong instinct for anyone touching an uncached GET later.
     */
    expect(routeModule).not.toHaveProperty('dynamic')
    expect(routeModule).not.toHaveProperty('revalidate')
    expect(routeModule).not.toHaveProperty('fetchCache')
  })

  it('opts into no cache anywhere on its path — under cacheComponents, caching is opt-IN', () => {
    const files = [
      'app/api/notifications/feed/route.ts',
      'lib/notifications/feed.ts',
      'db/notifications/feed.ts',
      'db/notifications/presence.ts',
    ]
    for (const f of files) {
      const source = readFileSync(resolve(process.cwd(), f), 'utf8')
      // A DIRECTIVE is a statement on its own line — not a mention inside the
      // comment above, which explains why the directive is deliberately absent.
      const directiveLines = source
        .split('\n')
        .map((l) => l.trim().replace(/;$/, ''))
        .filter((l) => l === "'use cache'" || l === '"use cache"')
      expect(directiveLines, f).toEqual([])
      expect(source.includes('unstable_cache('), f).toBe(false)
    }
  })

  it('sends Cache-Control: no-store on success', async () => {
    const res = await GET(req())
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('sends Cache-Control: no-store on the inert path too', async () => {
    process.env.NOTIFICATIONS_ENABLED = '0'
    const res = await GET(req())
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('sends Cache-Control: no-store on 401 and 403 — an error must not be cached either', async () => {
    h.getUser.mockResolvedValue(null)
    expect((await GET(req())).headers.get('cache-control')).toBe('no-store')

    h.getUser.mockResolvedValue(USER)
    h.getAgencyProductAccess.mockResolvedValue({ hasAccess: false })
    expect((await GET(req())).headers.get('cache-control')).toBe('no-store')
  })

  it('carries serverTime, so the client never uses its own clock as the cursor', async () => {
    const body = await (await GET(req())).json()
    expect(typeof body.serverTime).toBe('string')
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false)
  })
})
