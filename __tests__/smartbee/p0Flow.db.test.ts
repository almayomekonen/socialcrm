import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 1 (P0) customer-selection safety and stale cards, end to end against a
 * real (local test) PostgreSQL: owner message → webhook handler → worker →
 * card → tap → the REAL Action Runtime. Only the model and Meta are stood in
 * for. The model is deliberately WRONG about the lead on every later turn, to
 * prove the application, not the model, keeps the customer the owner chose.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { DOCUMENT_COPY } from '@/lib/waAssistant/smartbee/copy'
import { saveSmartbeeConnection } from '@/db/smartbee/connections'
import { __resetSmartbeeTokenCache } from '@/lib/integrations/providers/smartbee/auth'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let seq = 0
type Owner = { u: number; digits: string }

async function owner(): Promise<Owner> {
  const u = await user(A, 'ADMIN')
  const digits = `9725000097${String(++seq).padStart(2, '0')}`
  await recipient(A, u, digits, undefined, 'v4')
  await saveSmartbeeConnection({ agencyId: A, ownerUserId: u, environment: 'test', businessType: 'authorized', providerUserToken: `biz-${A}`, verifiedAt: new Date() })
  return { u, digits }
}
async function lead(o: Owner, lastName: string, phone: string | null = null) {
  const [c] = await db('clients').insert({ firstName: 'יוסי', lastName, phone, agencyId: A, userId: o.u, createdById: o.u, lead: true, status: 'new' }).returning('id')
  return Number(c.id)
}

/** What the model "proposes": a receipt for `clientId`, having read `seen`. */
const proposes = (clientId: number, seen: number[], over: Record<string, unknown> = {}) => ({
  ok: true as const,
  answer: {
    headline: 'ביקשתי',
    claims: [],
    unknown: null,
    proposedAction: {
      actionType: 'create_smartbee_document',
      args: { clientId, docType: 'Receipt', description: 'צילום', amount: 999, priceBasis: null, paymentMethod: null, paymentLabel: null, checkNumber: null, transferReference: null, installments: null, ...over },
      evidenceRefs: seen.map((l) => `lead:${l}`),
    },
  },
  evidence: seen.map((l) => ({ kind: 'lead', refId: String(l) })),
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_p0_${++seq}`,
  costUsd: 0,
})
const plain = (headline: string) => ({ ok: true as const, answer: { headline, claims: [], unknown: null, proposedAction: null }, evidence: [], steps: 1, stopReason: 'answered' as const, investigationId: `inv_p0_${++seq}`, costUsd: 0 })

function harness(results: unknown[]) {
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.P0_${++seq}` }))
  const deps = { runAgent: vi.fn(async () => results.shift() as never) as never, sendText: sendText as never, typing: (async () => undefined) as never, documents: { decide: { follow: vi.fn() as never } } }
  return { deps, last: () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string }[] } }
}
const msg = (o: Owner, extra: Record<string, unknown>) => processPlatformMessage({ id: `wamid.__p0_${++seq}`, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), ...extra } as never)
async function say(o: Owner, h: ReturnType<typeof harness>, body: string) {
  await msg(o, { type: 'text', text: { body } })
  await runWaAssistantWorker({}, h.deps)
  return h.last()
}
async function tap(o: Owner, h: ReturnType<typeof harness>, id: string) {
  await msg(o, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } })
  await runWaAssistantWorker({}, h.deps)
  return h.last()
}
const docs = () => db('smartbee_documents').where({ agencyId: A })
const proposedArgs = async () => (await db('agent_actions').where({ agencyId: A, actionType: 'create_smartbee_document' }).orderBy('id', 'desc').first('args'))?.args as Record<string, any>

beforeAll(async () => {
  A = await agency('__p0_a__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('smartbee_documents').where({ agencyId: A }).del()
  await db('smartbee_connections').where({ agencyId: A }).del()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('clients').where({ agencyId: A }).del()
  await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  __resetSmartbeeTokenCache()
  Object.assign(process.env, {
    WA_ASSISTANT_AGENCY_IDS: `${A}`,
    OWNER_WA_REMINDERS_AGENCY_IDS: `${A}`,
    SMARTBEE_AGENCY_IDS: `${A}`,
    SMARTBEE_TEST_CLIENT_ID: 'c',
    SMARTBEE_TEST_CLIENT_PASSWORD: 'p',
    PLATFORM_WHATSAPP_PHONE_NUMBER_ID: PLATFORM,
    PLATFORM_WHATSAPP_ACCESS_TOKEN: TOKEN,
  })
})
afterAll(async () => {
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('smartbee_documents').where({ agencyId: A }).del()
  await db('smartbee_connections').where({ agencyId: A }).del()
  await db('analytics_events').where({ agencyId: A }).del()
  await db('clients').where({ agencyId: A }).del()
  await cleanup()
})

describe('the customer the owner chose stays chosen for the whole document', () => {
  it('"2", then "מזומן": still customer 2, though the model proposes customer 1 every time', async () => {
    const o = await owner()
    const one = await lead(o, 'כהן')
    const two = await lead(o, 'לוי')
    const h = harness([proposes(one, [one, two]), proposes(one, [one, two]), proposes(one, [one, two])])

    const list = await say(o, h, 'תפיק קבלה ליוסי על צילום, 500 שקל')
    expect(list.body).toContain('איזה מהם?')
    expect((await say(o, h, '2')).body).toBe(DOCUMENT_COPY.askPayment)
    const card = await say(o, h, 'מזומן')
    expect(card.body).toContain('לקוח: יוסי לוי')
    expect(card.body).not.toContain('יוסי כהן')
    expect(await proposedArgs()).toMatchObject({ clientId: two, amount: 500, payment: { method: 'cash', amount: 500 } })
  })

  it('"1,500" answering the amount question never changes the customer, even when it matches a phone ending', async () => {
    const o = await owner()
    const one = await lead(o, 'כהן', '0501231500')
    const two = await lead(o, 'לוי', '0529998888')
    const h = harness([proposes(one, [one, two]), proposes(one, [one, two]), proposes(one, [one, two])])

    await say(o, h, 'תפיק קבלה ליוסי על צילום, שולם במזומן')
    expect((await say(o, h, '2')).body).toBe(DOCUMENT_COPY.askAmount)
    const card = await say(o, h, '1,500')
    expect(card.body).toContain('לקוח: יוסי לוי')
    expect(await proposedArgs()).toMatchObject({ clientId: two, amount: 1500 })
  })

  it('the amount on the card is the owner\'s, never the model\'s; "500" then "לא, 2000" → 2000', async () => {
    const o = await owner()
    const only = await lead(o, 'כהן')
    // The model keeps saying 500.
    const h = harness([1, 2, 3].map(() => proposes(only, [only], { amount: 500 })))

    expect((await say(o, h, 'תפיק קבלה ליוסי כהן על צילום, 500 שקל')).body).toBe(DOCUMENT_COPY.askPayment)
    // A correction of the amount, not a payment: the payment is asked again, and 2000 is kept.
    expect((await say(o, h, 'לא, 2000')).body).toBe(DOCUMENT_COPY.askPayment)
    const card = await say(o, h, 'מזומן')
    expect(card.body).toContain('₪2,000.00')
    expect(card.body).not.toContain('₪500.00')
    expect(await proposedArgs()).toMatchObject({ clientId: only, amount: 2000, payment: { method: 'cash', amount: 2000 } })
  })
})

describe('a correction voids the pending card', () => {
  const REQUEST = 'תפיק קבלה ליוסי כהן על צילום, 500 שקל, שולם במזומן'

  it('"לא, 2000" after a ₪500 card, answered with a question: the old card can no longer be approved', async () => {
    const o = await owner()
    const only = await lead(o, 'כהן')
    const h = harness([proposes(only, [only]), plain('מה הסכום הנכון?')])
    const card = await say(o, h, REQUEST)
    expect(card.body).toContain('₪500.00')
    await say(o, h, 'לא, 2000')
    expect(await tap(o, h, card.buttons![0].id)).toMatchObject({ body: DOCUMENT_COPY.superseded })
    expect(await docs()).toHaveLength(0)
  })

  it('small talk ("תודה") leaves the card approvable', async () => {
    const o = await owner()
    const only = await lead(o, 'כהן')
    const h = harness([proposes(only, [only]), plain('בשמחה')])
    const card = await say(o, h, REQUEST)
    await say(o, h, 'תודה')
    await tap(o, h, card.buttons![0].id)
    expect(await docs()).toHaveLength(1)
  })
})
