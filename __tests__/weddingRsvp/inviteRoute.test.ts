import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/wedding-rsvp/invite — who may call it. Session, agency and product
 * access are mocked; sendWeddingInvite is mocked so nothing is ever sent.
 */

const h = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), send: vi.fn() }))
vi.mock('@/db/auth', () => ({ getUser: h.getUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.access }))
vi.mock('@/lib/weddingRsvp/invite', () => ({ sendWeddingInvite: h.send }))

const { POST } = await import('@/app/api/wedding-rsvp/invite/route')

const req = (body: unknown) =>
  ({ json: async () => body }) as unknown as Parameters<typeof POST>[0]
const VALID = { phone: '0545862701', firstName: 'נדב', lastName: 'גטהון' }

beforeEach(() => {
  vi.clearAllMocks()
  h.getUser.mockResolvedValue({ id: 332, agencyId: 103 })
  h.access.mockResolvedValue({ hasAccess: true })
  h.send.mockResolvedValue({ ok: true, wamid: 'wamid.x' })
})

describe('POST /api/wedding-rsvp/invite — authorization', () => {
  it('no session → 401, nothing sent', async () => {
    h.getUser.mockResolvedValue(null)
    expect((await POST(req(VALID))).status).toBe(401)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('a signed-in user of another agency → 403, nothing sent (checked before product access)', async () => {
    h.getUser.mockResolvedValue({ id: 5, agencyId: 149 })
    const res = await POST(req(VALID))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'agency-not-allowed' })
    expect(h.access).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('wedding agency without product access → 403, nothing sent', async () => {
    h.access.mockResolvedValue({ hasAccess: false })
    expect((await POST(req(VALID))).status).toBe(403)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('malformed body → 400, nothing sent', async () => {
    expect((await POST(req({ phone: 545862701 }))).status).toBe(400)
    expect((await POST(req({ firstName: 'נדב' }))).status).toBe(400)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('authorized wedding-agency user → forwards exactly one invite for the session user', async () => {
    const res = await POST(req(VALID))
    expect(res.status).toBe(200)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send).toHaveBeenCalledWith({ agencyId: 103, userId: 332, phone: '0545862701', firstName: 'נדב', lastName: 'גטהון' })
  })

  it('a refusal from the invite logic is returned as 422', async () => {
    h.send.mockResolvedValue({ ok: false, error: 'already-invited' })
    const res = await POST(req(VALID))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ ok: false, error: 'already-invited' })
  })
})
