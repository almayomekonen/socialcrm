import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reservation failures are observable WITHOUT the database: a structured log
 * line with identifiers and a category, never the raw error text. Pure: the
 * reservation store and the database are mocked.
 */
const store = vi.hoisted(() => ({ reserve: vi.fn(), settle: vi.fn() }))
vi.mock('@/db/aiBudget', () => ({ reserveShadow: store.reserve, settleShadow: store.settle }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))

import { emitBudgetEvent, failureReason } from '@/lib/ai/budget/events'
import { newCallId, settleShadowAfter, startShadow } from '@/lib/ai/budget/shadow'
import { withAiOperation } from '@/lib/ai/usage/context'

const SECRET_ROW = 'Key (phone)=(+972501234567) customer said "hello", password=hunter2'
const pgError = (code: string, name = 'error') =>
  Object.assign(new Error(`duplicate key value violates: ${SECRET_ROW}`), { code, name })
const request = (over: Record<string, unknown> = {}) => ({
  callId: newCallId(),
  agencyId: 103,
  feature: 'inbox.autoResponse',
  provider: 'openai',
  model: 'gpt-5.6-sol',
  invocationId: 'inv-1',
  run: { kind: 'inbox.autoResponse', id: 'inv-1' },
  estimate: () => ({ usd: 0.01, basis: 'partial' as const, incomplete: true, note: null }),
  ...over,
})
const lines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c[0] === '[ai-budget]').map((c) => JSON.parse(String(c[1])) as Record<string, unknown>)

let err: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  process.env.AI_BUDGET_SHADOW = '1'
  store.reserve.mockReset()
  store.settle.mockReset()
  err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  delete process.env.AI_BUDGET_SHADOW
  err.mockRestore()
  warn.mockRestore()
})

describe('reservation_failed', () => {
  it('a database failure: one structured event with identifiers and a category — never the error text', async () => {
    store.reserve.mockRejectedValue(pgError('57P01'))
    const r = request()
    expect(await startShadow(r)).toBeNull() // the provider call goes ahead untouched
    const [e] = lines(err)
    expect(e).toMatchObject({
      evt: 'reservation_failed',
      callId: r.callId,
      invocationId: 'inv-1',
      operationKind: 'inbox.autoResponse',
      operationId: 'inv-1',
      feature: 'inbox.autoResponse',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      agencyId: 103,
      tenantKnown: true,
      stage: 'database',
      reason: 'db_unavailable',
      errorName: 'error',
      errorCode: '57P01',
    })
    expect(Date.parse(String(e.at))).not.toBeNaN()
    const raw = JSON.stringify(err.mock.calls)
    for (const leak of ['+972501234567', 'hunter2', 'hello', 'duplicate key']) expect(raw).not.toContain(leak)
  })

  it('the categories come from fixed vocabularies (SQLSTATE / errno / class name)', () => {
    expect(failureReason(Object.assign(new Error('x'), { name: 'KnexTimeoutError' }), 'database')).toBe('db_timeout')
    expect(failureReason(pgError('57014'), 'database')).toBe('db_timeout')
    expect(failureReason(pgError('ECONNREFUSED'), 'database')).toBe('db_unavailable')
    expect(failureReason(pgError('42P01'), 'database')).toBe('db_schema_missing')
    expect(failureReason(pgError('23514'), 'database')).toBe('db_constraint')
    expect(failureReason(pgError('40P01'), 'database')).toBe('db_conflict')
    expect(failureReason(new Error('?'), 'database')).toBe('unknown')
    expect(failureReason(new Error('?'), 'estimate')).toBe('estimate_failed')
  })

  it('missing tenant identity is reported as such, not guessed', async () => {
    store.reserve.mockRejectedValue(pgError('08006'))
    await startShadow(request({ agencyId: null }))
    expect(lines(err)[0]).toMatchObject({
      evt: 'reservation_failed',
      agencyId: null,
      tenantKnown: false,
      reason: 'db_unavailable',
    })
  })

  it('the tenant comes from the server-side operation context when the caller has none', async () => {
    store.reserve.mockRejectedValue(pgError('08006'))
    await withAiOperation({ kind: 'auto_response_job', id: '42', agencyId: 158 }, async () => {
      await startShadow(request({ agencyId: null, run: null }))
    })
    expect(lines(err)[0]).toMatchObject({
      agencyId: 158,
      tenantKnown: true,
      operationKind: 'auto_response_job',
      operationId: '42',
    })
  })

  it('a failing estimator is categorised separately, before any database write', async () => {
    await startShadow(
      request({
        estimate: () => {
          throw new Error('schema walk failed')
        },
      }),
    )
    expect(store.reserve).not.toHaveBeenCalled()
    expect(lines(err)[0]).toMatchObject({ evt: 'reservation_failed', stage: 'estimate', reason: 'estimate_failed' })
  })

  it('after a failed reservation, settlement does nothing (there is no row) and never throws', async () => {
    store.reserve.mockRejectedValue(pgError('57P01'))
    const h = startShadow(request())
    await settleShadowAfter(h, { outcome: 'success', usage: null, models: { requested: 'gpt-5.6-sol' } })
    expect(store.settle).not.toHaveBeenCalled()
    expect(lines(err).map((e) => e.evt)).toEqual(['reservation_failed'])
  })

  it('emitting never throws, even with an unserialisable error', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => emitBudgetEvent('reservation_failed', { callId: 'x', error: circular })).not.toThrow()
  })
})

describe('run_identity_missing', () => {
  it('a request with no run and no worker context is reported (warn), and still reserved', async () => {
    store.reserve.mockResolvedValue({ decision: 'would_allow' })
    await startShadow(request({ run: null }))
    expect(lines(warn)[0]).toMatchObject({ evt: 'run_identity_missing', operationId: null, feature: 'inbox.autoResponse' })
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({ operationId: null }))
  })

  it('a request with a run identity reports nothing', async () => {
    store.reserve.mockResolvedValue({ decision: 'would_allow' })
    await startShadow(request())
    expect(lines(warn)).toHaveLength(0)
    expect(lines(err)).toHaveLength(0)
  })
})
