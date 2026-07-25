import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Permission (admin-only, server-side), agency-scoping, and RFC §3/§4 behavior for
 * archive / discard / retry. All I/O mocked; the actions' logic runs for real.
 */

const h = vi.hoisted(() => ({
  requireAgencyUser: vi.fn(),
  isAdmin: vi.fn(),
  loadTemplateForMutation: vi.fn(),
  archiveTemplateRow: vi.fn(),
  discardTemplateRow: vi.fn(),
  deleteTemplateOnMeta: vi.fn(),
  createTemplate: vi.fn(),
  connection: { waba_id: 'WABA_1', access_token: 'secret-token' } as { waba_id: string; access_token: string } | undefined,
}))

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: h.requireAgencyUser, requireProductAccess: h.requireAgencyUser }))
vi.mock('@/types/roles', () => ({ isAdmin: h.isAdmin }))
vi.mock('@/db/whatsappTemplates', () => ({
  loadTemplateForMutation: h.loadTemplateForMutation,
  archiveTemplateRow: h.archiveTemplateRow,
  discardTemplateRow: h.discardTemplateRow,
}))
vi.mock('@/lib/whatsapp/templates/graph', () => ({ deleteTemplateOnMeta: h.deleteTemplateOnMeta }))
vi.mock('@/actions/whatsapp/templates/createTemplate', () => ({ createTemplate: h.createTemplate }))
vi.mock('@/config/db', () => ({
  db: () => ({ where: () => ({ first: async () => h.connection }) }),
}))

const { archiveTemplate } = await import('@/actions/whatsapp/templates/archiveTemplate')
const { discardTemplate } = await import('@/actions/whatsapp/templates/discardTemplate')
const { retryTemplate } = await import('@/actions/whatsapp/templates/retryTemplate')

const INPUT = { displayTitle: 'x', bodyText: 'y', purpose: 'UTILITY' as const, variables: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAgencyUser.mockResolvedValue({ id: 7, agencyId: 103, role: 'admin' })
  h.isAdmin.mockReturnValue(true)
  h.connection = { waba_id: 'WABA_1', access_token: 'secret-token' }
  h.archiveTemplateRow.mockResolvedValue(1)
  h.discardTemplateRow.mockResolvedValue(1)
  h.deleteTemplateOnMeta.mockResolvedValue({ ok: true })
})

describe('permission — every mutation is admin-only, server-side', () => {
  it('archive / discard / retry all reject a non-admin before any write', async () => {
    h.isAdmin.mockReturnValue(false)
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'approved', name: 'n', metaTemplateId: 'MT' })
    expect((await archiveTemplate(1)).ok).toBe(false)
    expect((await discardTemplate(1)).ok).toBe(false)
    expect((await retryTemplate(1, INPUT)).ok).toBe(false)
    expect(h.archiveTemplateRow).not.toHaveBeenCalled()
    expect(h.discardTemplateRow).not.toHaveBeenCalled()
    expect(h.createTemplate).not.toHaveBeenCalled()
  })
})

describe('agency scope', () => {
  it('loads the row scoped to the caller agency', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'approved', name: 'n', metaTemplateId: 'MT' })
    await archiveTemplate(1)
    expect(h.loadTemplateForMutation).toHaveBeenCalledWith(1, 103)
  })

  it('a row from another agency (not loaded) → not found', async () => {
    h.loadTemplateForMutation.mockResolvedValue(null)
    expect((await archiveTemplate(9)).ok).toBe(false)
    expect(h.archiveTemplateRow).not.toHaveBeenCalled()
  })
})

describe('archiveTemplate — approved only, Meta retained (RFC §4)', () => {
  it('archives an approved row (no Meta delete)', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'approved', name: 'n', metaTemplateId: 'MT' })
    expect(await archiveTemplate(1)).toEqual({ ok: true })
    expect(h.archiveTemplateRow).toHaveBeenCalledWith(1, 103)
    expect(h.deleteTemplateOnMeta).not.toHaveBeenCalled()
  })
  it('refuses to archive a pending/rejected row (use discard)', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'rejected', name: 'n', metaTemplateId: 'MT' })
    expect((await archiveTemplate(1)).ok).toBe(false)
    expect(h.archiveTemplateRow).not.toHaveBeenCalled()
  })
})

describe('discardTemplate — pending/rejected only, Meta delete + local remove (RFC §4)', () => {
  it('deletes from Meta then removes the local row', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'pending', name: 'promo', metaTemplateId: 'MT' })
    expect(await discardTemplate(1)).toEqual({ ok: true })
    expect(h.deleteTemplateOnMeta).toHaveBeenCalledWith('WABA_1', 'secret-token', 'promo')
    expect(h.discardTemplateRow).toHaveBeenCalledWith(1, 103)
  })
  it('refuses to discard an approved row (use archive)', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'approved', name: 'n', metaTemplateId: 'MT' })
    expect((await discardTemplate(1)).ok).toBe(false)
    expect(h.deleteTemplateOnMeta).not.toHaveBeenCalled()
    expect(h.discardTemplateRow).not.toHaveBeenCalled()
  })
  it('a Meta delete failure keeps the local row and returns the mapped error', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 1, status: 'rejected', name: 'promo', metaTemplateId: 'MT' })
    h.deleteTemplateOnMeta.mockResolvedValue({ ok: false, error: 'לא ניתן להסיר את ההודעה כרגע. נסו שוב.' })
    const res = await discardTemplate(1)
    expect(res).toEqual({ ok: false, error: 'לא ניתן להסיר את ההודעה כרגע. נסו שוב.' })
    expect(h.discardTemplateRow).not.toHaveBeenCalled()
  })
})

describe('retryTemplate — new template + archive old (RFC §3)', () => {
  it('creates a new template then archives the rejected one', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 5, status: 'rejected', name: 'promo', metaTemplateId: 'MT' })
    h.createTemplate.mockResolvedValue({ ok: true, template: { id: 99 } })
    const res = await retryTemplate(5, INPUT)
    expect(res).toEqual({ ok: true, template: { id: 99 } })
    expect(h.createTemplate).toHaveBeenCalledWith(INPUT)
    expect(h.archiveTemplateRow).toHaveBeenCalledWith(5, 103)
  })
  it('only a rejected row can be retried', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 5, status: 'approved', name: 'n', metaTemplateId: 'MT' })
    expect((await retryTemplate(5, INPUT)).ok).toBe(false)
    expect(h.createTemplate).not.toHaveBeenCalled()
  })
  it('if the new create fails, the old rejected row is NOT archived', async () => {
    h.loadTemplateForMutation.mockResolvedValue({ id: 5, status: 'rejected', name: 'promo', metaTemplateId: 'MT' })
    h.createTemplate.mockResolvedValue({ ok: false, error: 'שגיאה' })
    const res = await retryTemplate(5, INPUT)
    expect(res).toEqual({ ok: false, error: 'שגיאה' })
    expect(h.archiveTemplateRow).not.toHaveBeenCalled()
  })
})
