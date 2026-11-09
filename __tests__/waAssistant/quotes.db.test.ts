import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Quotes from WhatsApp, end to end against a real (local test) PostgreSQL: the
 * inbound webhook handler → the worker → a card → a tap → the REAL Action
 * Runtime, `create_quote` executor and `createQuoteSystem`. Only the model and
 * Meta are mocked; nothing leaves the test database. Same harness as
 * leadUpdates.db.test.ts.
 *
 * NOTE: over the 250-line soft limit on purpose, like leadUpdates.db.test.ts:
 * one flat list of independent scenarios over one shared harness.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled: () => flags.agent,
}))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { QUOTE_COPY } from '@/lib/waAssistant/quotes/copy'
import { COPY, NO_ACTIONS_NOTE } from '@/lib/waAssistant/render'
import { createQuoteAction, quoteAutomationKey } from '@/lib/agent/actions/domain/createQuote'
import { findActionByActionId } from '@/db/agentActions'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let C: number // no VAT rate configured
let seq = 0

type Owner = { u: number; r: number; digits: string; lead: number }

async function lead(agencyId: number, ownerUserId: number, firstName = 'דוד', lastName = 'כהן') {
  const [c] = await db('clients')
    .insert({ firstName, lastName, agencyId, userId: ownerUserId, createdById: ownerUserId, lead: true, status: 'new' })
    .returning('id')
  return Number(c.id)
}
async function owner(role = 'ADMIN', agencyId = A): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000074${String(++seq).padStart(2, '0')}`
  const r = await recipient(agencyId, u, digits, undefined, 'v4')
  return { u, r, digits, lead: await lead(agencyId, u) }
}

type Line = { title: string; quantity: number | null; unitAmount: number | null; discountAmount: number | null; discountPercent: number | null }
const item = (unitAmount: number | null, over: Partial<Line> = {}): Line => ({ title: 'שיפוץ מטבח', quantity: null, unitAmount, discountAmount: null, discountPercent: null, ...over })
const quote = (clientId: number, over: Partial<{ lines: Line[]; priceBasis: 'incl_vat' | 'excl_vat' | null; validityDays: number | null; title: string }> = {}) => ({
  actionType: 'create_quote' as const,
  args: { clientId, title: 'שיפוץ מטבח', lines: [item(18500)], priceBasis: 'incl_vat' as const, validityDays: null, ...over },
})
const answer = (p: ReturnType<typeof quote> | null, evidenceLeads: number[]) => ({
  ok: true as const,
  answer: { headline: 'ביקשתי', claims: [], unknown: null, proposedAction: p ? { ...p, evidenceRefs: evidenceLeads.map((l) => `lead:${l}`) } : null },
  evidence: evidenceLeads.map((l) => ({ kind: 'lead', refId: String(l) })),
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_wa_q_${++seq}`,
  costUsd: 0.01,
})

function harness(results: unknown[] = []) {
  const runAgent = vi.fn(async (_input: Record<string, any>) => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.Q_${++seq}` }))
  const startPdf = vi.fn(async () => 'started' as const)
  const deps = { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never, quotes: { decide: { startPdf: startPdf as never } } }
  const last = () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string; title: string }[]; toE164: string }
  return { runAgent, sendText, deps, last, startPdf }
}
async function say(o: Owner, body: string) {
  expect(
    await processPlatformMessage({ id: `wamid.__wa_q_${++seq}`, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }),
  ).toBe('assistant_queued')
}
const tap = (digits: string, buttonId: string) =>
  processPlatformMessage({
    id: `wamid.__wa_q_${++seq}`,
    from: digits,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
  })
const run = (h: ReturnType<typeof harness>) => runWaAssistantWorker({}, h.deps)
const quotesOf = (agencyId: number) => db('sales_quotes').where({ agencyId }).orderBy('id').select('id', 'leadId', 'status', 'quoteNumber', 'totalAmount', 'subtotalAmount', 'taxAmount', 'expiresAt', 'automationKey', 'createdByUserId')
const actionsOf = (agencyId: number) => db('agent_actions').where({ agencyId })

const REQUEST = 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ'

async function card(o: Owner, h: ReturnType<typeof harness>, words: string) {
  await say(o, words)
  await run(h)
  const sent = h.last()
  expect(sent.buttons, sent.body).toHaveLength(2)
  return { approve: sent.buttons![0].id, reject: sent.buttons![1].id, body: sent.body, titles: sent.buttons!.map((b) => b.title) }
}
const tokenOf = (buttonId: string) => buttonId.split(':')[2]

beforeAll(async () => {
  A = await agency('__wa_q_a__')
  B = await agency('__wa_q_b__')
  C = await agency('__wa_q_c__')
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id IN (?, ?, ?)`, [A, B, C])
  await db('bill_tax_rates').whereIn('agencyId', [A, B, C]).del()
  for (const agencyId of [A, B]) await db('bill_tax_rates').insert({ agencyId, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('sales_quotes').whereIn('agencyId', [A, B, C]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B, C]).del()
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).update({ ratePercent: 18 })
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('agencies').whereIn('id', [A, B, C]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B},${C}`
  process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = `${A},${B},${C}`
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B},${C}`
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN'])
    delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  // Quote items RESTRICT their tax rate, so the quotes go first.
  await db('sales_quotes').whereIn('agencyId', [A, B, C]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B, C]).del()
  await db('bill_tax_rates').whereIn('agencyId', [A, B, C]).del()
  await db('analytics_events').whereIn('agencyId', [A, B, C]).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('clients').whereIn('agencyId', [A, B, C]).del()
  await cleanup()
})

describe('created only after approval, numbered, ready, verified, once', () => {
  it('the Hebrew request → a card with every figure → nothing yet → approve → one ready quote', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    expect(c.titles).toEqual(['לאשר וליצור', 'ביטול'])
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).toContain('create_quote')
    for (const s of ['*ליצור הצעת מחיר?*', 'ליד: דוד כהן', 'נושא: שיפוץ מטבח', '1. שיפוץ מטבח: 1 × ₪15,677.97 = ₪15,677.97', 'כוללים מע"מ', 'סכום לפני מע"מ: ₪15,677.97', 'מע"מ (18%): ₪2,822.03', '*סה"כ: ₪18,500.00*', 'היא לא תישלח ללקוח'])
      expect(c.body).toContain(s)
    expect(c.body).not.toContain('תוקף:')
    expect(c.body).not.toContain('הנחות')
    expect(c.body).not.toContain('שימו לב')
    expect(await quotesOf(A)).toHaveLength(0)
    expect(await actionsOf(A)).toHaveLength(1)

    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toContain('*הצעת המחיר נוצרה ב-SocialCRM*')
    expect(h.last().body).toContain('מספר הצעה: 1')
    expect(h.last().body).toContain('סה"כ: ₪18,500.00')
    expect(h.last().body).toContain('ההצעה לא נשלחה ללקוח.')
    expect(h.last().body).toContain('קישור להורדה יגיע כאן')
    expect(h.startPdf).toHaveBeenCalledTimes(1)
    const [action] = await actionsOf(A)
    const quotes = await quotesOf(A)
    expect(quotes).toHaveLength(1)
    expect(quotes[0]).toMatchObject({ leadId: o.lead, status: 'ready', expiresAt: null, automationKey: quoteAutomationKey(action.actionId), createdByUserId: o.u })
    expect(Number(quotes[0].quoteNumber)).toBe(1)
    expect(Number(quotes[0].totalAmount)).toBe(18500)
    expect(Number(quotes[0].subtotalAmount)).toBe(15677.97)
    expect(Number(quotes[0].taxAmount)).toBe(2822.03)
    // Only the owner was messaged: one card, one confirmation, both to the owner's number.
    expect(h.sendText.mock.calls.every(([i]) => i.toE164 === `+${o.digits}`)).toBe(true)

    // The same button again: the token is single-use.
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.alreadyDecided)
    expect(await quotesOf(A)).toHaveLength(1)
  })

  it('a duplicate execution of the approved action returns the same quote', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await tap(o.digits, c.approve)
    await run(h)
    const [row] = await actionsOf(A)
    const action = await findActionByActionId(A, row.actionId)
    const ctx = { actor: { agencyId: A, userId: o.u, role: 'ADMIN', gotPermIds: [] }, nowMs: Date.now(), deadlineAtMs: Date.now() + 10_000 }
    const again = await createQuoteAction.execute({ ...(action as object), actionId: row.actionId, args: action!.args } as never, ctx as never)
    expect(again).toMatchObject({ status: 'SUCCESS', detail: { created: false, quoteNumber: 1 } })
    expect(await quotesOf(A)).toHaveLength(1)
  })

  it('verification re-reads the stored quote: a different total is a mismatch; the probe finds it by key', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await tap(o.digits, c.approve)
    await run(h)
    const [row] = await actionsOf(A)
    const action = (await findActionByActionId(A, row.actionId))!
    const ctx = { actor: { agencyId: A, userId: o.u, role: 'ADMIN', gotPermIds: [] }, nowMs: Date.now(), deadlineAtMs: Date.now() + 10_000 } as never
    const proposal = { actionId: row.actionId, args: action.args } as never
    const [q] = await quotesOf(A)
    const execution = { status: 'SUCCESS' as const, targetIds: [{ kind: 'quote', id: String(q.id) }] }
    expect(await createQuoteAction.verify(proposal, execution, ctx)).toMatchObject({ state: 'VERIFIED', verified: true })
    expect(await createQuoteAction.probe!(proposal, ctx)).toMatchObject({ state: 'VERIFIED', verified: true })

    await db('sales_quotes').where({ id: q.id }).update({ totalAmount: 1 })
    expect(await createQuoteAction.verify(proposal, execution, ctx)).toMatchObject({ state: 'MISMATCH', verified: false })
    expect(await createQuoteAction.probe!({ actionId: 'act_never_ran', args: action.args } as never, ctx)).toMatchObject({ state: 'NOT_FOUND', verified: false })
  })

  it('excluding VAT: "10,000 פלוס מע"מ" stores 10,000 + 1,800', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(10000)], priceBasis: 'excl_vat' }), [o.lead])])
    const c = await card(o, h, 'תכין הצעת מחיר לדוד על שיפוץ מטבח, 10,000 פלוס מע"מ')
    expect(c.body).toContain('לפני מע"מ')
    expect(c.body).toContain('*סה"כ: ₪11,800.00*')
    await tap(o.digits, c.approve)
    await run(h)
    expect(Number((await quotesOf(A))[0].totalAmount)).toBe(11800)
  })

  it('the basis is the OWNER\'s: the model says incl_vat, the owner said פלוס מע"מ', async () => {
    const o = await owner()
    const c = await card(o, harness([answer(quote(o.lead, { lines: [item(10000)], priceBasis: 'incl_vat' }), [o.lead])]), 'הצעת מחיר לדוד, 10,000 פלוס מע"מ')
    expect(c.body).toContain('*סה"כ: ₪11,800.00*')
  })

  it('a stated 10% discount, excluding VAT: represented and calculated on card and quote', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(20000, { title: 'ארונות', discountPercent: 10 })], priceBasis: 'excl_vat' }), [o.lead])])
    const c = await card(o, h, 'הצעת מחיר לדוד על ארונות, 20,000 עם 10% הנחה, לפני מע"מ')
    expect(c.body).toContain('הנחה 10% (₪2,000.00)')
    expect(c.body).toContain('הנחות: ₪2,000.00')
    expect(c.body).toContain('סכום לפני מע"מ: ₪18,000.00')
    expect(c.body).toContain('מע"מ (18%): ₪3,240.00')
    expect(c.body).toContain('*סה"כ: ₪21,240.00*')
    await tap(o.digits, c.approve)
    await run(h)
    const [q] = await db('sales_quotes').where({ agencyId: A }).select('subtotalAmount', 'discountAmount', 'taxAmount', 'totalAmount')
    expect([q.subtotalAmount, q.discountAmount, q.taxAmount, q.totalAmount].map(Number)).toEqual([18000, 2000, 3240, 21240])
  })

  it('a stated 10% discount, including VAT: the total is 90% of the stated price', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(23600, { title: 'ארונות', discountPercent: 10 })] }), [o.lead])])
    const c = await card(o, h, 'הצעת מחיר לדוד על ארונות, 23,600 כולל מע"מ עם 10% הנחה')
    expect(c.body).toContain('*סה"כ: ₪21,240.00*')
    expect(c.body).toContain('הנחה 10% (₪2,000.00)')
  })

  it('the percent is bound into the approved action', async () => {
    const o = await owner()
    await card(o, harness([answer(quote(o.lead, { lines: [item(20000, { title: 'ארונות', discountPercent: 10 })], priceBasis: 'excl_vat' }), [o.lead])]), 'הצעת מחיר לדוד על ארונות, 20,000 עם 10% הנחה, לפני מע"מ')
    const [row] = await actionsOf(A)
    expect((row.args as { lines: unknown[] }).lines[0]).toMatchObject({ unitAmount: 20000, discountAmount: 2000, discountPercent: 10 })
  })

  it('a rounding difference is shown, and the stored total is the card\'s', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(1.21, { title: 'בורג' })] }), [o.lead])])
    const c = await card(o, h, 'הצעת מחיר לדוד על בורג ב-1.21 כולל מע"מ')
    expect(c.body).toContain('שימו לב: בגלל עיגול לאגורות')
    const shown = /\*סה"כ: ₪([\d.,]+)\*/.exec(c.body)![1]
    expect(shown).not.toBe('1.21')
    await tap(o.digits, c.approve)
    await run(h)
    expect(Number((await quotesOf(A))[0].totalAmount)).toBe(Number(shown))
  })

  it('validity only when stated: "בתוקף ל-30 יום" → shown and stored', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { validityDays: 30 }), [o.lead])])
    const c = await card(o, h, `${REQUEST}, בתוקף ל-30 יום`)
    expect(c.body).toContain('תוקף: 30 ימים')
    await tap(o.digits, c.approve)
    await run(h)
    expect((await quotesOf(A))[0].expiresAt).not.toBeNull()
  })

  it('reject → no quote', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await tap(o.digits, c.reject)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.rejected)
    expect(await quotesOf(A)).toHaveLength(0)
  })
})

describe('missing or unstated details → one question, never a guess', () => {
  it('no price → asks; the answer continues the same request into a card', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(null)] }), [o.lead])])
    await say(o, 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
    expect(h.last().buttons).toBeUndefined()
    expect(await actionsOf(A)).toHaveLength(0)

    h.runAgent.mockResolvedValueOnce(answer(quote(o.lead), [o.lead]) as never)
    const c = await card(o, h, '18,500 כולל מע"מ')
    expect(c.body).toContain('*סה"כ: ₪18,500.00*')
  })

  it('a price the owner never said → asks, nothing recorded', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(15000)] }), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('no VAT basis → asks; "כולל" answers it', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { priceBasis: null }), [o.lead])])
    await say(o, 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askVat)
    expect(await actionsOf(A)).toHaveLength(0)
    expect(await db('wa_assistant_jobs').orderBy('id', 'desc').first('stopReason')).toEqual({ stopReason: 'quote_clarify_vat' })

    h.runAgent.mockResolvedValueOnce(answer(quote(o.lead, { priceBasis: null }), [o.lead]) as never)
    const c = await card(o, h, 'כולל')
    expect(c.body).toContain('*סה"כ: ₪18,500.00*')
  })

  it('a percent the owner never said → asks, nothing recorded', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(20000, { title: 'ארונות', discountPercent: 15 })], priceBasis: 'excl_vat' }), [o.lead])])
    await say(o, 'הצעת מחיר לדוד על ארונות, 20,000 עם 10% הנחה, לפני מע"מ')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('"10%" read as ₪10 is refused', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(20000, { title: 'ארונות', discountAmount: 10 })], priceBasis: 'excl_vat' }), [o.lead])])
    await say(o, 'הצעת מחיר לדוד על ארונות, 20,000 עם 10% הנחה, לפני מע"מ')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
  })

  it('a requested discount the proposal dropped → asks; "10%" then completes it', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(20000, { title: 'ארונות' })], priceBasis: 'excl_vat' }), [o.lead])])
    await say(o, 'הצעת מחיר לדוד על ארונות, 20,000 לפני מע"מ, עם הנחה')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askDiscount)
    expect(await actionsOf(A)).toHaveLength(0)
    h.runAgent.mockResolvedValueOnce(answer(quote(o.lead, { lines: [item(20000, { title: 'ארונות', discountPercent: 10 })], priceBasis: 'excl_vat' }), [o.lead]) as never)
    const c = await card(o, h, '10%')
    expect(c.body).toContain('*סה"כ: ₪21,240.00*')
  })

  it('a validity the owner never said → asks', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { validityDays: 30 }), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askValidity)
  })

  it('two leads named דוד → the owner chooses; "2" continues the same request', async () => {
    const o = await owner()
    const second = await lead(A, o.u, 'דוד', 'לוי')
    const h = harness([answer(quote(o.lead), [o.lead, second])])
    await say(o, 'תכין הצעת מחיר לדוד עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ')
    await run(h)
    expect(h.last().buttons).toBeUndefined()
    expect(h.last().body).toContain('איזה מהם?')
    expect(await actionsOf(A)).toHaveLength(0)

    h.runAgent.mockResolvedValueOnce(answer(quote(o.lead), [o.lead, second]) as never)
    const c = await card(o, h, '2')
    expect(c.body).toContain('ליד: דוד לוי')
  })

  describe('the item limit (H16): over it, nothing at all is created', () => {
    const NAME = 'התקנת ארון מטבח עליון'
    const items = (n: number) => Array.from({ length: n }, () => item(18500, { title: NAME }))
    const nothing = async () => {
      expect(await actionsOf(A)).toHaveLength(0)
      expect(await db('wa_assistant_approvals').where({ agencyId: A })).toHaveLength(0)
      expect(await db('sales_quotes').where({ agencyId: A })).toHaveLength(0)
      expect(await db('sales_quote_items').where({ agencyId: A })).toHaveLength(0)
      expect(await db('bill_numbering_sequences').where({ agencyId: A, kind: 'quote' })).toHaveLength(0)
    }
    const words = 'תכין הצעת מחיר לדוד כהן, כל פריט 18,500 שקל כולל מע"מ'

    it('12 medium-length items fit and every one is on the card and in the quote', async () => {
      const o = await owner()
      const h = harness([answer(quote(o.lead, { lines: items(12) }), [o.lead])])
      const c = await card(o, h, words)
      expect(c.body.length).toBeLessThanOrEqual(1024)
      expect(c.body.split(NAME)).toHaveLength(13)
      expect(c.body).toContain('*סה"כ: ₪222,000.06*')
      expect(c.body).toContain('שימו לב: בגלל עיגול לאגורות')
      await tap(o.digits, c.approve)
      await run(h)
      expect(await db('sales_quote_items').where({ agencyId: A })).toHaveLength(12)
    })

    it.each([
      [13, QUOTE_COPY.tooLongForCard],
      [30, QUOTE_COPY.tooLongForCard],
      [51, QUOTE_COPY.tooManyLines],
    ])('%i items are refused', async (n, text) => {
      const o = await owner()
      const h = harness([answer(quote(o.lead, { lines: items(n) }), [o.lead])])
      await say(o, words)
      await run(h)
      expect(h.last().body).toBe(text)
      expect(h.last().buttons).toBeUndefined()
      await nothing()
    })
  })

  it('a card too long to show in full is refused, never cut', async () => {
    const o = await owner()
    const lines = Array.from({ length: 30 }, (_, i) => item(100, { title: `פריט מספר ${i + 1} בהצעה` }))
    const h = harness([answer(quote(o.lead, { lines }), [o.lead])])
    await say(o, 'תכין הצעת מחיר לדוד, כל פריט 100 שקל כולל מע"מ')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.tooLongForCard)
    expect(h.last().buttons).toBeUndefined()
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('no VAT rate configured → refused with no fallback, nothing recorded', async () => {
    const o = await owner('ADMIN', C)
    const h = harness([answer(quote(o.lead), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.taxMissing)
    expect(await actionsOf(C)).toHaveLength(0)
  })
})

describe('authority: revalidated at the tap, never borrowed', () => {
  it("another agency's lead is refused before any card", async () => {
    const a = await owner()
    const b = await owner('ADMIN', B)
    const h = harness([answer(quote(a.lead), [a.lead])])
    await say(b, REQUEST)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.leadNotAllowed)
    expect(await actionsOf(B)).toHaveLength(0)
  })

  it("a rep cannot quote a colleague's lead", async () => {
    const boss = await owner()
    const rep = await owner('AGNT')
    const h = harness([answer(quote(boss.lead), [boss.lead])])
    await say(rep, REQUEST)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.leadNotAllowed)
    expect(await quotesOf(A)).toHaveLength(0)
  })

  it('the lead is reassigned away from the rep after the card → the tap creates nothing', async () => {
    const rep = await owner('AGNT')
    const other = await user(A, 'AGNT')
    const h = harness([answer(quote(rep.lead), [rep.lead])])
    const c = await card(rep, h, REQUEST)
    await db('clients').where({ id: rep.lead }).update({ userId: other })
    await tap(rep.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.notAuthorized)
    expect(await quotesOf(A)).toHaveLength(0)
  })

  it('a role that may not draft quotes is refused before any card', async () => {
    const ext = await owner('EXT')
    const h = harness([answer(quote(ext.lead), [ext.lead])])
    await say(ext, REQUEST)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.notAllowed)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('the role is lowered after the card → the tap creates nothing', async () => {
    const rep = await owner('AGNT')
    const h = harness([answer(quote(rep.lead), [rep.lead])])
    const c = await card(rep, h, REQUEST)
    await db('users').where({ id: rep.u }).update({ role: 'EXT' })
    await tap(rep.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.notAuthorized)
    expect(await quotesOf(A)).toHaveLength(0)
  })

  it('another user tapping the card finds nothing to approve', async () => {
    const o = await owner()
    const colleague = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await tap(colleague.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.notFound)
    expect(await quotesOf(A)).toHaveLength(0)
  })

  it('an expired card creates nothing', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await db('wa_assistant_approvals').where({ token: tokenOf(c.approve) }).update({ expiresAt: new Date(Date.now() - 60_000) })
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.expired)
    expect(await quotesOf(A)).toHaveLength(0)
  })

  it('a superseded card creates nothing; the newer one still works', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead]), answer(quote(o.lead, { lines: [item(20000)] }), [o.lead])])
    const first = await card(o, h, REQUEST)
    const second = await card(o, h, 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 20,000 שקל כולל מע"מ')
    await tap(o.digits, first.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.superseded)
    expect(await quotesOf(A)).toHaveLength(0)
    await tap(o.digits, second.approve)
    await run(h)
    expect(Number((await quotesOf(A))[0].totalAmount)).toBe(20000)
  })

  it('changed arguments invalidate the card', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await db('agent_actions').where({ agencyId: A }).update({ argsHash: 'f'.repeat(64) })
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.changed)
    expect(await quotesOf(A)).toHaveLength(0)
  })

  it('the VAT rate changes between card and tap → no quote at a total the owner never saw', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await db('bill_tax_rates').where({ agencyId: A }).update({ ratePercent: 17 })
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.staleTotals)
    expect(await quotesOf(A)).toHaveLength(0)
  })
})

describe('the switch', () => {
  it('off: the Agent is not told about quotes, and a proposal does nothing', async () => {
    delete process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).not.toContain('create_quote')
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(await actionsOf(A)).toHaveLength(0)
  })

  it('per agency: on for A only, so B gets no quote', async () => {
    process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = String(A)
    const b = await owner('ADMIN', B)
    const h = harness([answer(quote(b.lead), [b.lead])])
    await say(b, REQUEST)
    await run(h)
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).not.toContain('create_quote')
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(await actionsOf(B)).toHaveLength(0)
  })

  it('not "all": a non-numeric value enables nobody', async () => {
    process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = 'all'
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
  })

  it('turned off after the card: the tap creates nothing', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    delete process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(COPY.notAvailable)
    expect(await quotesOf(A)).toHaveLength(0)
  })
})

describe('the request allowance', () => {
  const CREDITS = { CREDITS_METERING: '1', CREDITS_ENFORCE_ON_PRO: '1', CREDITS_MONTHLY_ALLOWANCE: '1' }
  const requests = () => db('agent_requests').where({ agencyId: A }).select('tier')
  beforeEach(async () => {
    Object.assign(process.env, CREDITS, { CREDITS_ENFORCEMENT_AGENCY_IDS: String(A) })
    await db('agent_requests').where({ agencyId: A }).del()
  })
  afterEach(async () => {
    for (const k of [...Object.keys(CREDITS), 'CREDITS_ENFORCEMENT_AGENCY_IDS']) delete process.env[k]
    await db('agent_requests').where({ agencyId: A }).del()
  })

  it('the request that drafts the card is counted once, and approving it costs nothing more', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    expect(await requests()).toEqual([{ tier: 'free' }])

    // The allowance of 1 is now used up: the tap still executes, because it is not an AI request.
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await requests()).toEqual([{ tier: 'free' }])
    expect(await quotesOf(A)).toHaveLength(1)
  })

  it('declining the card costs nothing more either', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead), [o.lead])])
    const c = await card(o, h, REQUEST)
    await tap(o.digits, c.reject)
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await requests()).toEqual([{ tier: 'free' }])
    expect(await quotesOf(A)).toHaveLength(0)
  })
})

describe('a quote that totals ₪0', () => {
  const ZERO = 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 0 שקל כולל מע"מ'
  const zero = (o: Owner) => answer(quote(o.lead, { lines: [item(0)] }), [o.lead])
  const noWrites = async () => {
    expect(await quotesOf(A)).toHaveLength(0)
    expect(await actionsOf(A)).toHaveLength(0)
    expect(await db('bill_numbering_sequences').where({ agencyId: A })).toHaveLength(0)
  }

  it('asks first: no card, no action, no number', async () => {
    const o = await owner()
    const h = harness([zero(o)])
    await say(o, ZERO)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askFree)
    expect(h.last().buttons ?? []).toHaveLength(0)
    await noWrites()
  })

  it('"בחינם" answers the question: a card, then a ₪0 quote with a number', async () => {
    const o = await owner()
    const h = harness([zero(o), zero(o)])
    await say(o, ZERO)
    await run(h)
    const c = await card(o, h, 'בחינם')
    expect(c.body).toContain('₪0.00')
    await tap(o.digits, c.approve)
    await run(h)
    expect(await quotesOf(A)).toMatchObject([{ status: 'ready', quoteNumber: '1', totalAmount: '0.00' }])
  })

  it('a bare "כן" is not the explicit confirmation: it asks again and writes nothing', async () => {
    const o = await owner()
    const h = harness([zero(o), zero(o)])
    await say(o, ZERO)
    await run(h)
    await say(o, 'כן')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askFree)
    await noWrites()
  })

  it('a real price instead takes the normal path', async () => {
    const o = await owner()
    const h = harness([zero(o), answer(quote(o.lead, { lines: [item(5000)] }), [o.lead])])
    await say(o, ZERO)
    await run(h)
    expect((await card(o, h, 'לא, 5,000')).body).toContain('₪5,000.00')
  })

  it('said free in the request: straight to the card', async () => {
    const o = await owner()
    const h = harness([zero(o)])
    expect((await card(o, h, `${ZERO}, בחינם`)).body).toContain('₪0.00')
  })

  it('a 100% discount is a ₪0 quote too', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(20000, { discountPercent: 100 })], priceBasis: 'excl_vat' }), [o.lead])])
    await say(o, 'הצעת מחיר לדוד כהן על ארונות 20,000 עם 100% הנחה, לפני מע"מ')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askFree)
    await noWrites()
  })

  it.each([
    ['בחינם', 'תכין הצעת מחיר בחינם לדוד כהן עבור שיפוץ מטבח'],
    ['ללא תשלום', 'תכין הצעת מחיר ללא תשלום לדוד כהן עבור שיפוץ מטבח'],
  ])('"%s" with no digit: a ₪0 card, and a quote only after the tap', async (_word, words) => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(0)], priceBasis: null }), [o.lead])])
    const c = await card(o, h, words)
    expect(c.body).toContain('₪0.00')
    expect(c.body).toContain('(הצעה בחינם, ללא חיוב.)')
    expect(c.body).not.toContain('המחירים שנמסרו')
    expect(await quotesOf(A)).toHaveLength(0)
    expect(await db('bill_numbering_sequences').where({ agencyId: A })).toHaveLength(0)
    await tap(o.digits, c.approve)
    await run(h)
    expect(await quotesOf(A)).toMatchObject([{ status: 'ready', quoteNumber: '1', totalAmount: '0.00' }])
  })

  it.each([
    'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח במחיר טוב',
    'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח',
    'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, ללא תשלום מראש',
    'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, אולי בחינם',
    'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח בחינם?',
  ])('a zero the owner did not state stays refused: "%s"', async (words) => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(0)], priceBasis: null }), [o.lead])])
    await say(o, words)
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
    await noWrites()
  })

  it('a price beside the free word: the model cannot zero it, it asks', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(0)], priceBasis: null }), [o.lead])])
    await say(o, 'הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 5,000 בחינם')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
    await noWrites()
  })

  it('the free word does not ground any other invented price', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(500)], priceBasis: 'incl_vat' }), [o.lead])])
    await say(o, 'תכין הצעת מחיר בחינם לדוד כהן עבור שיפוץ מטבח')
    await run(h)
    expect(h.last().body).toBe(QUOTE_COPY.askPrice)
    await noWrites()
  })

  it('a free line by name inside a paid quote', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(1000), item(0, { title: 'התקנה' })] }), [o.lead])])
    const c = await card(o, h, 'הצעת מחיר לדוד כהן: ארונות 1,000, התקנה בחינם, כולל מע"מ')
    expect(c.body).toContain('₪1,000.00')
    expect(c.body).not.toContain('הצעה בחינם')
  })

  it('a free line inside a paid quote needs no question', async () => {
    const o = await owner()
    const h = harness([answer(quote(o.lead, { lines: [item(1000), item(0, { title: 'התקנה' })] }), [o.lead])])
    expect((await card(o, h, 'הצעת מחיר לדוד כהן: ארונות 1,000, התקנה 0, כולל מע"מ')).body).toContain('₪1,000.00')
  })
})
