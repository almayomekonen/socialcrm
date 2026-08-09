import { describe, expect, it, vi } from 'vitest'
import { quoteExecutor, type QuoteDeps } from '@/lib/automations/executors/quote'
import { sendOnceKey } from '@/lib/automations/laws'
import type { ExecutionContext } from '@/lib/automations/executors/types'

/**
 * `quote.create` — the first action whose EFFECT IS A WRITE.
 *
 * Every action before it either sent something or created a task, and the
 * engine's contract for a failure is "throw, release the claim, retry". For a
 * writing action that contract is a duplication hazard, so the tests that matter
 * most here are the idempotency ones.
 */

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  agencyId: 7,
  automationId: 3,
  leadId: 42,
  mode: 'live',
  subject: {},
  recipients: {},
  parameters: { quoteTemplateId: '5' },
  ...over,
})

const template = { template: { id: 5, name: 'בניית אתר' }, items: [{}] } as never

const deps = (over: Partial<QuoteDeps> = {}): QuoteDeps => ({
  handlerId: vi.fn(async () => 11),
  loadTemplate: vi.fn(async () => template),
  findExisting: vi.fn(async () => null),
  createQuote: vi.fn(async () => ({ ok: true as const, quoteId: 900, created: true })),
  ...over,
})

describe('preflight — configuration faults are definitive, never retried', () => {
  it('no template chosen', async () => {
    const r = await quoteExecutor.preflight(ctx({ parameters: {} }), deps())
    expect(r.problem?.reason).toBe('template_not_chosen')
    expect(r.ready).toBeNull()
  })

  it('a non-numeric or zero id is not a template', async () => {
    for (const v of ['', 'abc', '0', '-1']) {
      const r = await quoteExecutor.preflight(ctx({ parameters: { quoteTemplateId: v } }), deps())
      expect(r.problem?.reason, `id=${v}`).toBe('template_not_chosen')
    }
  })

  it('a template that is gone, archived or emptied is unavailable', async () => {
    // `getQuoteTemplateSystem` returns null for all three, which is exactly why
    // the check is a re-read at execution rather than trust from config time.
    const r = await quoteExecutor.preflight(ctx(), deps({ loadTemplate: vi.fn(async () => null) }))
    expect(r.problem?.reason).toBe('template_unavailable')
  })

  it('a lead with no handler has nobody to own the quote', async () => {
    const r = await quoteExecutor.preflight(ctx(), deps({ handlerId: vi.fn(async () => null) }))
    expect(r.problem?.reason).toBe('no_handler')
  })

  it('reads the template under the JOB’s agency, never a parameter', async () => {
    const d = deps()
    await quoteExecutor.preflight(ctx(), d)
    expect(d.loadTemplate).toHaveBeenCalledWith(7, 5)
    expect(d.handlerId).toHaveBeenCalledWith(7, 42)
  })

  it('resolves cleanly and carries what execute needs', async () => {
    const r = await quoteExecutor.preflight(ctx(), deps())
    expect(r.problem).toBeNull()
    expect(r.ready).toEqual({ templateId: 5, ownerUserId: 11, templateName: 'בניית אתר', existingQuoteId: null })
  })

  it('performs NO write — preflight runs before the claim', async () => {
    const d = deps()
    await quoteExecutor.preflight(ctx(), d)
    expect(d.createQuote).not.toHaveBeenCalled()
  })
})

describe('execute — observation mode', () => {
  it('writes nothing and reports would_send', async () => {
    const d = deps()
    const ready = (await quoteExecutor.preflight(ctx({ mode: 'log' }), d)).ready!
    const out = await quoteExecutor.execute(ctx({ mode: 'log' }), ready, d)
    expect(out.kind).toBe('would_send')
    expect(d.createQuote).not.toHaveBeenCalled()
    // ADR-009: a would_send row that had written a quote would make every pilot
    // metric a lie about what the engine did.
  })
})

describe('execute — the idempotency contract', () => {
  it('creates the quote under the ENGINE’s own once-ever key', async () => {
    const d = deps()
    const ready = (await quoteExecutor.preflight(ctx(), d)).ready!
    await quoteExecutor.execute(ctx(), ready, d)
    expect(d.createQuote).toHaveBeenCalledWith({
      agencyId: 7,
      leadId: 42,
      templateId: 5,
      createdByUserId: 11,
      automationKey: sendOnceKey(3, 42),
    })
    // Not a second scheme: the same key the send-once claim is built on.
    expect(sendOnceKey(3, 42)).toBe('auto:3:lead:42:ever')
  })

  it('a retry after a partial failure converges on the existing quote', async () => {
    // THE HAZARD THIS PINS. `execute` writes, and a throw releases the claim so
    // the job retries — which without the unique key would create a second quote.
    const d = deps({ createQuote: vi.fn(async () => ({ ok: true as const, quoteId: 900, created: false })) })
    const ready = (await quoteExecutor.preflight(ctx(), d)).ready!
    const out = await quoteExecutor.execute(ctx(), ready, d)
    expect(out.kind).toBe('sent')
    expect(out.log.reason).toBe('quote_already_present')
    expect(out.log.quoteId).toBe(900)
  })

  it('reports a fresh creation distinctly from a converged one', async () => {
    const d = deps()
    const ready = (await quoteExecutor.preflight(ctx(), d)).ready!
    expect((await quoteExecutor.execute(ctx(), ready, d)).log.reason).toBe('quote_created')
  })

  it('a domain failure throws, so the engine retries rather than losing it', async () => {
    const d = deps({ createQuote: vi.fn(async () => ({ ok: false as const, reason: 'conflict_unresolved' as const })) })
    const ready = (await quoteExecutor.preflight(ctx(), d)).ready!
    await expect(quoteExecutor.execute(ctx(), ready, d)).rejects.toThrow('quote: conflict_unresolved')
  })
})

describe('the action’s declared shape', () => {
  it('substitutes no variables — a price is never assembled from a token', () => {
    expect([...quoteExecutor.resolvableFields]).toEqual([])
  })

  it('offers no test send — there is no inert recipient for a quote', () => {
    expect(quoteExecutor.test).toBeUndefined()
  })

  it('the summary names the template the rep will recognise', async () => {
    const d = deps()
    const ready = (await quoteExecutor.preflight(ctx(), d)).ready!
    expect((await quoteExecutor.execute(ctx(), ready, d)).summary).toBe('בניית אתר')
  })
})
