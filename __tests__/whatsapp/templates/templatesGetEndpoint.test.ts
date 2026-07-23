import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUser, listTemplates } = vi.hoisted(() => ({ getUser: vi.fn(), listTemplates: vi.fn() }))
vi.mock('@/db/auth', () => ({ getUser }))
vi.mock('@/db/whatsappTemplates', () => ({ listTemplates }))

const { GET } = await import('@/app/api/whatsapp/templates/route')

beforeEach(() => {
  getUser.mockReset()
  listTemplates.mockReset()
})

describe('GET /api/whatsapp/templates — DB-only, agency-scoped', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(listTemplates).not.toHaveBeenCalled()
  })

  it('returns the agency templates from the local DB (no Graph)', async () => {
    getUser.mockResolvedValue({ agencyId: 103 })
    listTemplates.mockResolvedValue([{ id: 1, status: 'approved' }])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(listTemplates).toHaveBeenCalledWith(103)
    expect(await res.json()).toEqual({ templates: [{ id: 1, status: 'approved' }] })
  })
})
