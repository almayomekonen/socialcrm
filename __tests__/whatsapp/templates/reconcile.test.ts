import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reconcileWabaTemplates, extractBodyText } from '@/lib/whatsapp/templates/sync'
import { listTemplatesFromMeta } from '@/lib/whatsapp/templates/graph'

describe('extractBodyText', () => {
  it('pulls the BODY component text; empty when absent', () => {
    expect(extractBodyText([{ type: 'BODY', text: 'hi {{1}}' }])).toBe('hi {{1}}')
    expect(extractBodyText([{ type: 'HEADER' }])).toBe('')
    expect(extractBodyText(null)).toBe('')
  })
})

describe('reconcileWabaTemplates — adopt Meta, idempotent', () => {
  const metaTemplates = [
    { id: 'MT_1', name: 'follow_up', language: 'he', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'היי {{1}}' }] },
    { id: 'MT_2', name: 'promo', language: 'he', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'ABUSIVE_CONTENT', components: [{ type: 'BODY', text: 'מבצע' }] },
  ]

  it('upserts each Meta template with mapped status + rejection key', async () => {
    const upsert = vi.fn(async (_input?: unknown) => {})
    const list = vi.fn(async () => ({ ok: true as const, templates: metaTemplates }))
    const res = await reconcileWabaTemplates({ agencyId: 103, wabaId: 'WABA_1', accessToken: 't' }, { list, upsert })

    expect(res).toEqual({ scanned: 2, upserted: 2 })
    expect(upsert.mock.calls[0][0]).toMatchObject({ agencyId: 103, wabaId: 'WABA_1', name: 'follow_up', status: 'approved', metaTemplateId: 'MT_1', rejectionReason: null, bodyText: 'היי {{1}}' })
    expect(upsert.mock.calls[1][0]).toMatchObject({ name: 'promo', status: 'rejected', rejectionReason: 'policy' })
    // raw Meta reason never propagated
    expect(JSON.stringify(upsert.mock.calls[1][0])).not.toContain('ABUSIVE_CONTENT')
  })

  it('is idempotent — a second run issues the same upserts (identity-keyed)', async () => {
    const calls: unknown[] = []
    const upsert = vi.fn(async (i: unknown) => { calls.push(i) })
    const list = vi.fn(async () => ({ ok: true as const, templates: metaTemplates }))
    await reconcileWabaTemplates({ agencyId: 103, wabaId: 'WABA_1', accessToken: 't' }, { list, upsert })
    const firstRun = JSON.stringify(calls.splice(0))
    await reconcileWabaTemplates({ agencyId: 103, wabaId: 'WABA_1', accessToken: 't' }, { list, upsert })
    expect(JSON.stringify(calls)).toEqual(firstRun)
  })

  it('a Graph list failure skips the WABA (no upserts, no throw)', async () => {
    const upsert = vi.fn(async (_input?: unknown) => {})
    const list = vi.fn(async () => ({ ok: false as const }))
    const res = await reconcileWabaTemplates({ agencyId: 1, wabaId: 'W', accessToken: 't' }, { list, upsert })
    expect(res).toEqual({ scanned: 0, upserted: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('listTemplatesFromMeta', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('paginates and aggregates templates', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: '1', name: 'a', language: 'he', status: 'APPROVED', category: 'UTILITY' }], paging: { next: 'PAGE2' } }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: '2', name: 'b', language: 'he', status: 'PENDING', category: 'UTILITY' }] }) } as unknown as Response)
    const res = await listTemplatesFromMeta('WABA_1', 'tok')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.templates.map((t) => t.id)).toEqual(['1', '2'])
    expect(spy).toHaveBeenCalledTimes(2)
    expect((spy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('returns { ok:false } on a Graph error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as unknown as Response)
    expect(await listTemplatesFromMeta('WABA_1', 'tok')).toEqual({ ok: false })
  })
})
