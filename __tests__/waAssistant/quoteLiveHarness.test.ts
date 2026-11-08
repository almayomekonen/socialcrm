import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetStop, ceilingFor, createBudget } from '../live/quote/budget'
import { HarnessRefused, assertRealBucket, assertSafeToRun, installNetworkGuard, readPrivateEnvFile, scrubSecrets, type NetworkGuard } from '../live/quote/safety'
import { scoreRun, type RunObservation, type TurnObservation } from '../live/quote/evaluate'
import { SCENARIOS, variantFor } from '../live/quote/scenarios'

/** The walls and the scorer of the live harnesses. If these lie, every result does. */

const price = { inputPerM: 10, cachedInputPerM: 1, outputPerM: 20 }
const ok = (usage: unknown, status = 200) => async () => new Response(JSON.stringify({ usage }), { status })
const req = (chars = 100) => ({ method: 'POST', body: JSON.stringify({ x: 'a'.repeat(chars), max_output_tokens: 1000 }) })

describe('budget', () => {
  const make = (inner: typeof fetch, capUsd = 1) => createBudget({ inner, capUsd, reserveUsd: 0.1, price, defaultMaxOutputTokens: 1000 })

  it('charges reported usage, with cached input at its own rate', async () => {
    const b = make(ok({ input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 400 } }) as never)
    await b.fetch('https://x', req())
    expect(b.state.spentUsd).toBeCloseTo((600 * 10 + 400 * 1 + 100 * 20) / 1_000_000, 8)
  })
  it('refuses before the request leaves when the ceiling would break the limit, and stays stopped', async () => {
    const inner = vi.fn(ok({ input_tokens: 1, output_tokens: 1 })) as never as typeof fetch
    const b = make(inner, 0.5)
    await expect(b.fetch('https://x', req(400_000))).rejects.toBeInstanceOf(BudgetStop)
    await expect(b.fetch('https://x', req(1))).rejects.toBeInstanceOf(BudgetStop)
    expect(inner).not.toHaveBeenCalled()
    expect(b.state).toMatchObject({ stopped: true, refusedRequests: 2, spentUsd: 0 })
  })
  it('never lets spend pass the cap, however many requests run', async () => {
    const b = make(ok({ input_tokens: 2000, output_tokens: 1000 }) as never, 0.3)
    for (let i = 0; i < 100; i++) await b.fetch('https://x', req()).catch(() => undefined)
    expect(b.state.stopped).toBe(true)
    expect(b.state.spentUsd).toBeLessThanOrEqual(0.3)
  })
  it('counts concurrent requests against the limit', async () => {
    let release = () => {}
    const held = new Promise<void>((r) => (release = r))
    const b = make((async () => (await held, new Response('{}'))) as never, 0.13)
    const first = b.fetch('https://x', req(100))
    await expect(b.fetch('https://x', req(100))).rejects.toBeInstanceOf(BudgetStop)
    release()
    await first
  })
  it('keeps the ceiling when usage is missing or the network fails', async () => {
    const body = req()
    const a = make(ok(undefined) as never)
    await a.fetch('https://x', body)
    expect(a.state.spentUsd).toBeCloseTo(ceilingFor(body.body, 1000, price), 8)
    const c = make((async () => { throw new Error('reset') }) as never)
    await c.fetch('https://x', body).catch(() => undefined)
    expect(c.state.spentUsd).toBeCloseTo(ceilingFor(body.body, 1000, price), 8)
  })
  it('a provider refusal costs nothing', async () => {
    const b = make(ok(undefined, 401) as never)
    await b.fetch('https://x', req())
    expect(b.state.spentUsd).toBe(0)
  })
})

describe('safety', () => {
  const safe = { NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/x_test' }
  it('accepts only a local database named _test', () => {
    expect(() => assertSafeToRun(safe)).not.toThrow()
    for (const bad of [{ ...safe, NODE_ENV: 'production' }, { ...safe, VERCEL: '1' }, { ...safe, CI: '1' }, { ...safe, DATABASE_URL: 'postgres://u:p@ep-winter-star.neon.tech/neondb_test' }, { ...safe, DATABASE_URL: 'postgres://u:p@localhost/prod' }, { ...safe, DATABASE_URL: '' }])
      expect(() => assertSafeToRun(bad)).toThrow(HarnessRefused)
  })
  it('a key file must be private and git-ignored', () => {
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'qlive')), 'k')
    writeFileSync(f, 'QUOTE_LIVE_API_KEY=abc\n')
    chmodSync(f, 0o644)
    expect(() => readPrivateEnvFile(f, { ignored: () => true })).toThrow(HarnessRefused)
    chmodSync(f, 0o600)
    expect(() => readPrivateEnvFile(f, { ignored: () => false })).toThrow(HarnessRefused)
    expect(readPrivateEnvFile(f, { ignored: () => true })).toEqual({ QUOTE_LIVE_API_KEY: 'abc' })
  })
  it('real cloud mode accepts only a visibly-test, confirmed bucket', () => {
    const good = { R2_BUCKET_NAME: 'quotes-test', QUOTE_CLOUD_CONFIRM_BUCKET: 'quotes-test', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', CLOUDFLARE_BROWSER_RENDERING_API_TOKEN: 'd' }
    expect(() => assertRealBucket(good)).not.toThrow()
    for (const bad of [{ ...good, R2_BUCKET_NAME: 'socialcrm-files', QUOTE_CLOUD_CONFIRM_BUCKET: 'socialcrm-files' }, { ...good, QUOTE_CLOUD_CONFIRM_BUCKET: 'other' }, { ...good, R2_SECRET_ACCESS_KEY: '' }])
      expect(() => assertRealBucket(bad)).toThrow(HarnessRefused)
  })
  it('removes secrets except those kept', () => {
    const env: Record<string, string | undefined> = { R2_SECRET_ACCESS_KEY: 'a', PLATFORM_WHATSAPP_ACCESS_TOKEN: 'b', META_APP_SECRET: 'c', KEEP_SECRET: 'd', DATABASE_URL: 'e', NODE_ENV: 'test' }
    scrubSecrets(env, ['KEEP_SECRET'])
    expect(Object.keys(env).sort()).toEqual(['DATABASE_URL', 'KEEP_SECRET', 'NODE_ENV'])
  })
  describe('network guard', () => {
    let guard: NetworkGuard
    afterEach(() => guard.uninstall())
    it('refuses and records every host but the allowed one', async () => {
      const inner = vi.fn(async () => new Response('{}'))
      guard = installNetworkGuard({ allowedHosts: ['api.openai.com'], inner: inner as never })
      await fetch('https://api.openai.com/v1/responses')
      await expect(fetch('https://graph.facebook.com/v21.0/x')).rejects.toBeInstanceOf(HarnessRefused)
      await expect(fetch('https://x.r2.cloudflarestorage.com/o')).rejects.toBeInstanceOf(HarnessRefused)
      expect(() => net.connect({ host: 'ep-winter-star.neon.tech', port: 5432 })).toThrow(HarnessRefused)
      expect(inner).toHaveBeenCalledTimes(1)
      expect(guard.refusals).toEqual(['fetch:graph.facebook.com', 'fetch:x.r2.cloudflarestorage.com', 'socket:ep-winter-star.neon.tech'])
    })
  })
})

describe('scoring', () => {
  const H1 = variantFor(SCENARIOS[0], 0)
  const BODY = ['*ליצור הצעת מחיר?*', 'ליד: דוד כהן', 'נושא: x', 'פריטים:', '1. שיפוץ מטבח: 1', 'סכום לפני מע"מ: ₪15,677.97', 'מע"מ (18%): ₪2,822.03', '*סה"כ: ₪18,500.00*', 'היא לא תישלח ללקוח'].join('\n')
  const args = { clientId: 7, lines: [{ title: 'שיפוץ מטבח', quantity: 1, unitAmount: 18500, discountAmount: null }], priceBasis: 'incl_vat', validityDays: null, expectedTotalAmount: 18500, expectedRatePercent: 18 }
  const turn = (over: Partial<TurnObservation> = {}, a: Record<string, unknown> = args): TurnObservation => ({ stopReason: 'quote_awaiting_approval', body: BODY, buttons: 2, proposal: null, action: { args: a }, ...over })
  const run = (t: TurnObservation, over: Partial<RunObservation> = {}): RunObservation => ({ turns: [t], leadIdByName: { 'דוד כהן': 7 }, ownerE164: '+972', outboundTo: ['+972'], stored: { totalAmount: 18500, lineCount: 1, status: 'ready' }, ...over })
  const kinds = (r: RunObservation, v = H1) => scoreRun(v, r).findings.map((f) => f.kind)

  it('a correct card passes', () => expect(scoreRun(H1, run(turn())).passed).toBe(true))
  it('wrong lead', () => expect(kinds(run(turn({}, { ...args, clientId: 8 })))).toContain('wrong_lead'))
  it('an invented price', () => expect(kinds(run(turn({}, { ...args, lines: [{ ...args.lines[0], unitAmount: 15000 }], expectedTotalAmount: 15000 })))).toContain('invented_value'))
  it('a VAT error: wrong basis, wrong total', () => {
    expect(kinds(run(turn({}, { ...args, priceBasis: 'excl_vat' })))).toContain('vat_error')
    expect(kinds(run(turn({}, { ...args, expectedTotalAmount: 21830 })))).toContain('vat_error')
  })
  it('an incomplete card', () => expect(kinds(run(turn({ body: BODY.replace('היא לא תישלח ללקוח', '') })))).toContain('incomplete_card'))
  it('an omitted line', () => {
    const H2 = variantFor(SCENARIOS[1], 0)
    expect(kinds(run(turn({}, args)), H2)).toContain('omission')
  })
  it('an omitted discount', () => {
    const H13 = variantFor(SCENARIOS.find((s) => s.id === 'H13')!, 0)
    expect(kinds(run(turn({}, { ...args, lines: [{ title: 'ארונות', quantity: 1, unitAmount: 20000, discountAmount: null }], priceBasis: 'excl_vat', expectedTotalAmount: 23600 })), H13)).toContain('omission')
  })
  it('a validity nobody said', () => expect(kinds(run(turn({}, { ...args, validityDays: 30 })))).toContain('invented_value'))
  it('a stored total that differs from the card', () => expect(kinds(run(turn(), { stored: { totalAmount: 18499, lineCount: 1, status: 'ready' } }))).toContain('stored_mismatch'))
  it('a message to anyone but the owner', () => expect(kinds(run(turn(), { outboundTo: ['+972', '+97250'] }))).toContain('customer_contact'))
  it('a card where a question was right', () => {
    const H6 = variantFor(SCENARIOS.find((s) => s.id === 'H6')!, 0)
    expect(kinds(run(turn()), H6)).toContain('unexpected_outcome')
  })
  it('counts a model invention the gate caught', () => {
    const r = run(turn({ buttons: 0, action: null, stopReason: 'quote_clarify_price', proposal: { actionType: 'create_quote', args: { lines: [{ unitAmount: 15000, quantity: null }] } } }), { stored: null })
    expect(scoreRun({ turns: H1.turns, steps: [{ kind: 'question' }] }, r).modelInventionsCaught).toBe(1)
  })
  it('all nineteen scenarios exist, and each price works out', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(Array.from({ length: 19 }, (_, i) => `H${i + 1}`))
  })
})
