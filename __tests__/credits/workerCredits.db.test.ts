import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The allowance through the REAL WhatsApp assistant worker. The Agent and the
 * sender are injected: nothing reaches Meta or a model.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { creditLimitText } from '@/lib/waAssistant/creditLimitReply'
import { creditPurchaseUrl, purchaseLinkAgency } from '@/lib/credits/purchaseLink'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

const A = 103
let seq = 0
const ENV: Record<string, string> = { CREDITS_METERING: '1', CREDITS_ENFORCEMENT_AGENCY_IDS: String(A), CREDITS_ENFORCE_ON_PRO: '1', CREDITS_MONTHLY_ALLOWANCE: '1', WA_ASSISTANT_AGENCY_IDS: String(A), OWNER_WA_REMINDERS_AGENCY_IDS: String(A), PLATFORM_WHATSAPP_PHONE_NUMBER_ID: PLATFORM, PLATFORM_WHATSAPP_ACCESS_TOKEN: TOKEN }
const answer = { ok: true as const, answer: { headline: 'כותרת', claims: [], proposedAction: null, proposedBatch: null }, evidence: [], steps: 1, stopReason: 'answered' as const, investigationId: 'inv_t', costUsd: 0.01 }

function harness() {
  const runAgent = vi.fn(async (_i: Record<string, any>) => answer as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.CR_${++seq}` }))
  return { runAgent, sendText, deps: { runAgent: runAgent as never, sendText: sendText as never, typing: vi.fn(async () => undefined) as never } }
}
async function ask(from: string, body: string, id = `wamid.__cr_${++seq}`) {
  const r = await processPlatformMessage({ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } })
  return { id, r }
}
const requests = () => db('agent_requests').where({ agencyId: A }).orderBy('id').select('*')

beforeAll(async () => {
  await agency('__cr_103__', A)
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('agent_requests').where({ agencyId: A }).del()
  await db('wa_assistant_jobs').del()
  await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  Object.assign(process.env, ENV)
})
afterAll(async () => {
  for (const k of [...Object.keys(ENV), 'WA_ASSISTANT_REMINDERS_AGENCY_IDS', 'CREDITS_LINK_SECRET']) delete process.env[k]
  await db('agent_requests').where({ agencyId: A }).del()
  await db('wa_assistant_jobs').del()
  await db('analytics_events').where({ agencyId: A }).del()
  await cleanup()
})

async function owner(digits: string) {
  const u = await user(A, 'ADMIN')
  await recipient(A, u, digits, undefined, 'v3')
  return u
}

describe('request 51 on WhatsApp', () => {
  it('does not run the Agent, replies once with the link, and later messages are rate limited', async () => {
    await owner('972500007001')
    const h = harness()
    await ask('972500007001', 'שאלה ראשונה')
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)

    const second = await ask('972500007001', 'שאלה שנייה')
    await runWaAssistantWorker({}, h.deps)
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(h.sendText).toHaveBeenCalledTimes(2)
    const body = h.sendText.mock.calls[1][0].body as string
    expect(body).toContain('השתמשתם ב-1 הבקשות')
    expect(body).toContain('https://getsocialcrm.com/settings/update_payment')
    expect(body).not.toMatch(/\$|USD|token|provider/i)
    expect(await db('wa_assistant_jobs').where({ wamid: second.id }).first()).toMatchObject({ stopReason: 'credits_required', replyState: 'sent' })

    await ask('972500007001', 'שאלה שלישית')
    await runWaAssistantWorker({}, h.deps)
    expect(h.sendText).toHaveBeenCalledTimes(2)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
  })

  it('a redelivered webhook counts once', async () => {
    await owner('972500007002')
    const h = harness()
    const first = await ask('972500007002', 'שאלה')
    expect(first.r).toBe('assistant_queued')
    const again = await ask('972500007002', 'שאלה', first.id)
    expect(again.r).not.toBe('assistant_queued')
    await runWaAssistantWorker({}, h.deps)
    expect(await requests()).toHaveLength(1)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
  })

  it('what does not reach the Agent is not counted', async () => {
    await owner('972500007003')
    const h = harness()
    await processPlatformMessage({ id: `wamid.__cr_${++seq}`, from: '972500007003', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'x' } })
    await runWaAssistantWorker({}, h.deps)
    expect(await requests()).toEqual([])
  })

  it('with nothing enforced the assistant behaves as before', async () => {
    delete process.env.CREDITS_METERING
    await owner('972500007004')
    const h = harness()
    await ask('972500007004', 'א')
    await ask('972500007004', 'ב')
    await runWaAssistantWorker({}, h.deps)
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(2)
    expect(await requests()).toEqual([])
  })
})

describe('the message and the link', () => {
  it('Hebrew and English, full and short, with no cost detail', () => {
    const url = 'https://x/y'
    expect(creditLimitText('full', 'he', 50, url)).toContain('50 הבקשות')
    expect(creditLimitText('full', 'en', 50, url)).toContain('50 smart-assistant requests')
    for (const t of [creditLimitText('short', 'he', 50, url), creditLimitText('short', 'en', 50, url)]) expect(t).toContain(url)
    expect(creditLimitText('full', 'en', 50, url)).not.toMatch(/token|provider|\$/i)
  })

  it('a signed link names its agency; a forged, altered or expired one names nobody', () => {
    process.env.CREDITS_LINK_SECRET = 'test-secret'
    const t = new URL(creditPurchaseUrl(7, 1000)).searchParams.get('credits')!
    expect(purchaseLinkAgency(t, 2000)).toBe(7)
    expect(purchaseLinkAgency(t.replace(/^7\./, '8.'), 2000)).toBeNull()
    expect(purchaseLinkAgency('7.99999999999999.forged', 2000)).toBeNull()
    expect(purchaseLinkAgency(t, 1000 + 31 * 86_400_000)).toBeNull()
    delete process.env.CREDITS_LINK_SECRET
    expect(creditPurchaseUrl(7)).toBe('https://getsocialcrm.com/settings/update_payment')
    expect(purchaseLinkAgency(t, 2000)).toBeNull()
  })
})
