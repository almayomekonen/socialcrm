import { describe, it, expect, vi } from 'vitest'
import { isCreateRateLimited, TEMPLATE_CREATE_LIMIT, RATE_LIMIT_MESSAGE } from '@/lib/whatsapp/templates/rateLimit'
import type { Knex } from 'knex'

function connReturning(count: number) {
  const captured: { where: unknown[] } = { where: [] }
  const q: Record<string, unknown> = {}
  Object.assign(q, {
    where: (arg: unknown) => (captured.where.push(arg), q),
    count: async () => [{ n: count }],
  })
  const conn = (() => q) as unknown as Knex
  return { conn, captured }
}

describe('isCreateRateLimited', () => {
  it('false below the limit', async () => {
    const { conn } = connReturning(TEMPLATE_CREATE_LIMIT.max - 1)
    expect(await isCreateRateLimited(103, conn)).toBe(false)
  })

  it('true at / above the limit', async () => {
    expect(await isCreateRateLimited(103, connReturning(TEMPLATE_CREATE_LIMIT.max).conn)).toBe(true)
    expect(await isCreateRateLimited(103, connReturning(TEMPLATE_CREATE_LIMIT.max + 5).conn)).toBe(true)
  })

  it('is agency-scoped', async () => {
    const { conn, captured } = connReturning(0)
    await isCreateRateLimited(103, conn)
    expect(captured.where).toContainEqual({ agencyId: 103 })
  })

  it('exposes a Hebrew message', () => {
    expect(RATE_LIMIT_MESSAGE).toMatch(/[֐-׿]/)
    expect(RATE_LIMIT_MESSAGE).not.toMatch(/\d{3,}/)
  })
})

describe('deleteTemplateOnMeta', () => {
  it('maps a Graph delete error to Hebrew (never raw)', async () => {
    const { deleteTemplateOnMeta } = await import('@/lib/whatsapp/templates/graph')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'boom' } }) } as unknown as Response)
    const out = await deleteTemplateOnMeta('WABA_1', 'tok', 'promo')
    expect(out.ok).toBe(false)
    if ('error' in out) {
      expect(out.error).toMatch(/[֐-׿]/)
      expect(out.error).not.toContain('boom')
    }
    vi.restoreAllMocks()
  })

  it('DELETE with the name + Bearer token; ok on 200', async () => {
    const { deleteTemplateOnMeta } = await import('@/lib/whatsapp/templates/graph')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response)
    const out = await deleteTemplateOnMeta('WABA_1', 'tok', 'promo')
    expect(out).toEqual({ ok: true })
    expect(String(spy.mock.calls[0][0])).toContain('name=promo')
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
    expect((spy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' })
    vi.restoreAllMocks()
  })
})
