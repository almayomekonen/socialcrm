import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Permission is server-side only, the token never appears in the result, and a
 * Graph failure persists nothing (so the client rolls back). `@/config/db`,
 * `requireAgencyUser`, the Graph client, `insertOptimistic`, and `isAdmin` are
 * mocked; validation / component-assembly run for real.
 */

const h = vi.hoisted(() => ({
  requireAgencyUser: vi.fn(),
  isAdmin: vi.fn(),
  createTemplateOnMeta: vi.fn(),
  insertOptimistic: vi.fn(),
  isCreateRateLimited: vi.fn(),
  state: { connection: undefined as { waba_id: string; access_token: string } | undefined, existingNames: [] as string[] },
}))

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: h.requireAgencyUser }))
vi.mock('@/types/roles', () => ({ isAdmin: h.isAdmin }))
vi.mock('@/lib/whatsapp/templates/graph', () => ({ createTemplateOnMeta: h.createTemplateOnMeta }))
vi.mock('@/lib/whatsapp/templates/rateLimit', () => ({ isCreateRateLimited: h.isCreateRateLimited, RATE_LIMIT_MESSAGE: 'RATE_MSG' }))
vi.mock('@/db/whatsappTemplates', () => ({ insertOptimistic: h.insertOptimistic }))
vi.mock('@/config/db', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      where: () => b,
      first: async () => (table === 'whatsapp_connections' ? h.state.connection : undefined),
      pluck: async () => (table === 'whatsapp_templates' ? h.state.existingNames : []),
    })
    return b
  }
  return { db: (table: string) => builder(table) }
})

const { createTemplate } = await import('@/actions/whatsapp/templates/createTemplate')

const INPUT = {
  displayTitle: 'תזכורת פולואפ',
  bodyText: 'היי שם הליד, רצינו להזכיר.',
  purpose: 'UTILITY' as const,
  variables: [{ token: 'שם הליד', sample: 'דוד' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAgencyUser.mockResolvedValue({ id: 7, agencyId: 103, role: 'admin' })
  h.isAdmin.mockReturnValue(true)
  h.state.connection = { waba_id: 'WABA_1', access_token: 'secret-token' }
  h.state.existingNames = []
  h.createTemplateOnMeta.mockResolvedValue({ ok: true, metaTemplateId: 'MT_1', status: 'PENDING' })
  h.insertOptimistic.mockResolvedValue({ id: 55, displayTitle: 'תזכורת פולואפ', status: 'pending', bodyText: 'x', variables: [], failureText: null, archived: false, createdAt: '2026-07-23T00:00:00Z' })
  h.isCreateRateLimited.mockResolvedValue(false)
})

describe('createTemplate — rate limit (server-side, RFC §13)', () => {
  it('rejects with a mapped message before Graph when over the limit', async () => {
    h.isCreateRateLimited.mockResolvedValue(true)
    const res = await createTemplate(INPUT)
    expect(res).toEqual({ ok: false, error: 'RATE_MSG' })
    expect(h.createTemplateOnMeta).not.toHaveBeenCalled()
    expect(h.insertOptimistic).not.toHaveBeenCalled()
  })
})

describe('createTemplate — permission (server-side only)', () => {
  it('non-admin is rejected before any Graph call or persist', async () => {
    h.isAdmin.mockReturnValue(false)
    const res = await createTemplate(INPUT)
    expect(res).toEqual({ ok: false, error: 'אין הרשאה ליצור הודעות מוכנות.' })
    expect(h.createTemplateOnMeta).not.toHaveBeenCalled()
    expect(h.insertOptimistic).not.toHaveBeenCalled()
  })
})

describe('createTemplate — validation', () => {
  it('rejects invalid input before Graph', async () => {
    const res = await createTemplate({ ...INPUT, displayTitle: '' })
    expect(res.ok).toBe(false)
    expect(h.createTemplateOnMeta).not.toHaveBeenCalled()
  })
})

describe('createTemplate — connection', () => {
  it('errors when the agency has no WABA/token', async () => {
    h.state.connection = undefined
    const res = await createTemplate(INPUT)
    expect(res).toEqual({ ok: false, error: 'צריך לחבר וואטסאפ עסקי לפני יצירת הודעות מוכנות.' })
    expect(h.createTemplateOnMeta).not.toHaveBeenCalled()
  })
})

describe('createTemplate — happy path', () => {
  it('assembles the Meta payload, sends via Graph with the token, and persists a pending row', async () => {
    const res = await createTemplate(INPUT)
    expect(res.ok).toBe(true)
    // Graph called with token + assembled payload
    const args = h.createTemplateOnMeta.mock.calls[0][0]
    expect(args.wabaId).toBe('WABA_1')
    expect(args.accessToken).toBe('secret-token')
    expect(args.language).toBe('he')
    expect(args.category).toBe('UTILITY')
    expect(args.name).toMatch(/^[a-z0-9_]+$/) // slug, no PII/Hebrew
    expect(args.components[0].type).toBe('BODY')
    expect(args.components[0].text).toContain('{{1}}')
    // persisted after Meta accepted
    expect(h.insertOptimistic).toHaveBeenCalledTimes(1)
    expect(h.insertOptimistic.mock.calls[0][0]).toMatchObject({ agencyId: 103, wabaId: 'WABA_1', metaTemplateId: 'MT_1', createdByUserId: 7 })
  })

  it('uniquifies the Meta name against existing names', async () => {
    h.state.existingNames = ['follow_up']
    await createTemplate({ ...INPUT, displayTitle: 'Follow Up' })
    expect(h.createTemplateOnMeta.mock.calls[0][0].name).toBe('follow_up_2')
  })

  it('the result never contains the access token', async () => {
    const res = await createTemplate(INPUT)
    expect(JSON.stringify(res)).not.toContain('secret-token')
  })
})

describe('createTemplate — Graph failure rolls back (nothing persisted)', () => {
  it('returns the mapped Hebrew error and never persists', async () => {
    h.createTemplateOnMeta.mockResolvedValue({ ok: false, error: 'הגעתם למכסת ההודעות היומית של וואטסאפ. נסו שוב מחר.' })
    const res = await createTemplate(INPUT)
    expect(res).toEqual({ ok: false, error: 'הגעתם למכסת ההודעות היומית של וואטסאפ. נסו שוב מחר.' })
    expect(h.insertOptimistic).not.toHaveBeenCalled()
  })
})
