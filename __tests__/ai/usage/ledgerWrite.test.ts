import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The ledger write's bounded wait. Pure: the database builder and Next's
 * `after()` are mocked so the insert's timing can be controlled. Proves the AI
 * request path waits at most LEDGER_WAIT_MS, a slow insert is handed to the
 * request lifecycle (never an orphan promise) with a query timeout, and a
 * delayed or failed write is reported without its error text.
 */
const insert = vi.hoisted(() => ({
  result: (() => Promise.resolve()) as () => Promise<unknown>,
  calls: [] as unknown[],
  timeout: [] as unknown[],
}))
vi.mock('@/config/db', () => ({
  db: () => ({
    insert: (rows: unknown) => {
      insert.calls.push(rows)
      const builder = {
        onConflict: () => ({
          ignore: () => ({
            timeout: (ms: number, opts: unknown) => {
              insert.timeout.push([ms, opts])
              return insert.result()
            },
          }),
        }),
      }
      return builder
    },
  }),
}))
const lifecycle = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[] }))
vi.mock('next/server', () => ({ after: (t: Promise<unknown>) => void lifecycle.tasks.push(t) }))

import { LEDGER_QUERY_TIMEOUT_MS, LEDGER_WAIT_MS, recordProviderCalls } from '@/lib/ai/usage/record'

const call = {
  invocationId: 'inv-w',
  feature: 'inbox.autoResponse',
  provider: 'openai',
  requestedModel: 'gpt-5.6',
  responseModel: 'gpt-5.6-sol',
  status: 'success' as const,
  agencyId: 103,
  usage: { inputTokens: 10, uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
}
const lines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c[0] === '[ai-usage]').map((c) => JSON.parse(String(c[1])) as Record<string, unknown>)

let err: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  process.env.AI_USAGE_LEDGER = '1'
  insert.calls = []
  insert.timeout = []
  insert.result = () => Promise.resolve()
  lifecycle.tasks = []
  err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  delete process.env.AI_USAGE_LEDGER
  err.mockRestore()
  warn.mockRestore()
})

describe('bounded ledger write', () => {
  it('a fast insert: persisted within the wait, under the lifecycle, with a query timeout; nothing reported', async () => {
    await recordProviderCalls([call])
    expect(insert.calls).toHaveLength(1)
    expect(insert.timeout).toEqual([[LEDGER_QUERY_TIMEOUT_MS, { cancel: true }]])
    expect(lifecycle.tasks).toHaveLength(1)
    expect(lines(err)).toEqual([])
    expect(lines(warn)).toEqual([])
  })

  it('a slow insert: the request path waits at most LEDGER_WAIT_MS; the write finishes under after(); reported as delayed', async () => {
    let finish!: () => void
    insert.result = () => new Promise<void>((r) => (finish = r))
    const t0 = Date.now()
    await recordProviderCalls([call])
    const waited = Date.now() - t0
    expect(waited).toBeGreaterThanOrEqual(LEDGER_WAIT_MS - 20)
    expect(waited).toBeLessThan(LEDGER_WAIT_MS + 500)
    expect(lines(warn)).toEqual([
      expect.objectContaining({
        evt: 'ledger_write_delayed',
        invocationId: 'inv-w',
        agencyId: 103,
        rows: 1,
        waitedMs: LEDGER_WAIT_MS,
      }),
    ])
    finish()
    await lifecycle.tasks[0] // the lifecycle holds the write until it completes
    expect(lines(err)).toEqual([]) // it then succeeded: no failure event
  })

  it('a database failure never throws into the AI path and is reported with a category, not its text', async () => {
    insert.result = () => Promise.reject(Object.assign(new Error('could not write row (phone 0501234567)'), { code: '57P01' }))
    await expect(recordProviderCalls([call])).resolves.toBeUndefined()
    expect(lines(err)).toEqual([
      expect.objectContaining({
        evt: 'ledger_write_failed',
        reason: 'db_unavailable',
        errorCode: '57P01',
        rows: 1,
        agencyId: 103,
      }),
    ])
    expect(JSON.stringify(err.mock.calls)).not.toContain('0501234567')
  })

  it('a slow insert that then fails: reported delayed AND failed', async () => {
    let fail!: (e: unknown) => void
    insert.result = () => new Promise<void>((_r, j) => (fail = j))
    await recordProviderCalls([call])
    expect(lines(warn).map((e) => e.evt)).toEqual(['ledger_write_delayed'])
    fail(Object.assign(new Error('Knex: Timeout'), { name: 'KnexTimeoutError' }))
    await lifecycle.tasks[0]
    expect(lines(err)).toEqual([expect.objectContaining({ evt: 'ledger_write_failed', reason: 'db_timeout' })])
  })

  it('flag absent: no insert, no lifecycle task, no event', async () => {
    delete process.env.AI_USAGE_LEDGER
    await recordProviderCalls([call])
    expect(insert.calls).toHaveLength(0)
    expect(lifecycle.tasks).toHaveLength(0)
  })
})
