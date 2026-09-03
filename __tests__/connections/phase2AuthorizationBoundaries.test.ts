/**
 * Phase 2 security hardening — the authorization boundaries, asserted.
 *
 * Every finding these cover was a MISSING guard, never a wrong one, so the
 * assertions are deliberately about two things: that a forbidden caller is
 * refused, and that the destructive call never happened. A test that only
 * checked the status code would still pass if the delete ran first and the 403
 * were written afterwards.
 *
 * Unit-level: `@/db/auth` is mocked so the real `requireUser` and the real
 * `lib/api/routeAuth` execute against a staged session. The DB harness is
 * unavailable here — the same approach as facebookConnect.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  deletedForAgency: [] as number[],
  auditReads: [] as number[],
}))

vi.mock('@/db/auth', () => ({
  getUser: async () => h.session,
  decrypt: async () => ({}),
  encrypt: async () => 'tok',
}))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/db/whatsapp', () => ({
  deleteWhatsappConnectionsForAgency: async (agencyId: number) => {
    h.deletedForAgency.push(agencyId)
    return 1
  },
  getWhatsappConnectionAuditForAgency: async (agencyId: number) => {
    h.auditReads.push(agencyId)
    return { id: 7, waba_id: 'w', onboarding_type: 'embedded', health_status: 'ok' }
  },
}))

const ADMIN = { id: 1, role: 'ADMIN', agencyId: 10, suspended: false }
const GM = { id: 2, role: 'GM', agencyId: 10, suspended: false }
const AGNT = { id: 3, role: 'AGNT', agencyId: 10, suspended: false }
const SUSPENDED_ADMIN = { id: 4, role: 'ADMIN', agencyId: 10, suspended: true }
const NO_AGENCY = { id: 5, role: 'ADMIN', agencyId: null, suspended: false }

beforeEach(() => {
  h.session = null
  h.deletedForAgency = []
  h.auditReads = []
})

describe('routeAuth — the shared guard', () => {
  it('refuses an absent session', async () => {
    const { requireActiveAgencyUser } = await import('@/lib/api/routeAuth')
    expect((await requireActiveAgencyUser()).reason).toBe('unauthenticated')
  })

  it('refuses a suspended user — the bypass this phase closes', async () => {
    h.session = SUSPENDED_ADMIN
    const { requireActiveAgencyUser } = await import('@/lib/api/routeAuth')
    expect((await requireActiveAgencyUser()).reason).toBe('suspended')
  })

  it('refuses a user with no agency', async () => {
    h.session = NO_AGENCY
    const { requireActiveAgencyUser } = await import('@/lib/api/routeAuth')
    expect((await requireActiveAgencyUser()).reason).toBe('no_agency')
  })

  it('admits an ordinary active user at the base level', async () => {
    h.session = AGNT
    const { requireActiveAgencyUser } = await import('@/lib/api/routeAuth')
    const r = await requireActiveAgencyUser()
    expect(r.ok).toBe(true)
    expect(r.user?.id).toBe(3)
  })

  it('admits ADMIN and GM as admins, refuses AGNT', async () => {
    const { requireAgencyAdmin } = await import('@/lib/api/routeAuth')
    h.session = ADMIN
    expect((await requireAgencyAdmin()).ok).toBe(true)
    h.session = GM
    expect((await requireAgencyAdmin()).ok).toBe(true)
    h.session = AGNT
    expect((await requireAgencyAdmin()).reason).toBe('forbidden')
  })

  it('reports a suspended admin as suspended, not as an admin', async () => {
    // Ordering: identity and suspension settle before the role test.
    h.session = SUSPENDED_ADMIN
    const { requireAgencyAdmin } = await import('@/lib/api/routeAuth')
    expect((await requireAgencyAdmin()).reason).toBe('suspended')
  })

  it('maps unauthenticated to 401 and every other denial to 403', async () => {
    const { statusFor } = await import('@/lib/api/routeAuth')
    expect(statusFor('unauthenticated')).toBe(401)
    expect(statusFor('suspended')).toBe(403)
    expect(statusFor('forbidden')).toBe(403)
    expect(statusFor('no_agency')).toBe(403)
  })
})

describe('WhatsApp disconnect — agency-wide, so admin-only', () => {
  async function post() {
    const { POST } = await import('@/app/api/auth/whatsapp/disconnect/route')
    return POST(new Request('http://t/api/auth/whatsapp/disconnect', { method: 'POST' }) as never)
  }

  it('refuses an AGNT and deletes nothing', async () => {
    h.session = AGNT
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.deletedForAgency).toEqual([])
  })

  it('does not even read the connection audit for a forbidden caller', async () => {
    // The guard sits above the read as well as the delete: a caller who may not
    // disconnect may not enumerate the connection's metadata either.
    h.session = AGNT
    await post()
    expect(h.auditReads).toEqual([])
  })

  it('refuses a suspended admin and deletes nothing', async () => {
    h.session = SUSPENDED_ADMIN
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.deletedForAgency).toEqual([])
  })

  it('refuses an unauthenticated caller with 401', async () => {
    h.session = null
    const res = await post()
    expect(res.status).toBe(401)
    expect(h.deletedForAgency).toEqual([])
  })

  it('still lets an admin disconnect, scoped to their own agency', async () => {
    h.session = ADMIN
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.deletedForAgency).toEqual([10])
  })

  it('lets a GM disconnect — isAdmin admits GM, as every server action does', async () => {
    h.session = GM
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.deletedForAgency).toEqual([10])
  })
})

describe('WhatsApp OAuth start — the flow begins behind the same boundary', () => {
  it('sends a forbidden caller back to settings, never to Meta', async () => {
    h.session = AGNT
    const { GET } = await import('@/app/api/auth/whatsapp/route')
    const res = await GET(new Request('http://t/api/auth/whatsapp') as never)
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/settings/integrations')
    expect(location).not.toContain('facebook.com')
  })

  it('sends an unauthenticated caller to /auth', async () => {
    h.session = null
    const { GET } = await import('@/app/api/auth/whatsapp/route')
    const res = await GET(new Request('http://t/api/auth/whatsapp') as never)
    expect(res.headers.get('location') ?? '').toContain('/auth')
  })
})

describe('WhatsApp Embedded Signup — the other connect path', () => {
  /**
   * The canonical connect endpoint is /api/whatsapp/embedded-signup, a sibling of
   * /api/auth/whatsapp/connect that writes the same `whatsapp_connections` row.
   * Guarding one and not the other would have left the boundary open, so this
   * exists specifically to keep the two from drifting apart.
   */
  async function post(body: unknown = { code: 'c', wabaId: 'w', phoneNumberId: 'p' }) {
    const { POST } = await import('@/app/api/whatsapp/embedded-signup/route')
    return POST(
      new Request('http://t/api/whatsapp/embedded-signup', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }) as never,
    )
  }

  it('refuses an AGNT', async () => {
    h.session = AGNT
    expect((await post()).status).toBe(403)
  })

  it('refuses a suspended admin', async () => {
    h.session = SUSPENDED_ADMIN
    expect((await post()).status).toBe(403)
  })

  it('refuses an unauthenticated caller with 401', async () => {
    h.session = null
    expect((await post()).status).toBe(401)
  })

  it('does not refuse an admin at the authorization step', async () => {
    // It may still fail downstream on the mocked Graph calls; what matters is
    // that the refusal is no longer 401/403.
    h.session = ADMIN
    const res = await post()
    expect([401, 403]).not.toContain(res.status)
  })
})
