/**
 * Measurement: agent, automation, WhatsApp delivery and founder usage stay
 * apart; missing cost is flagged; automation and delivery never touch the
 * balance. Reminders run through the REAL gate with a mock sender.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { admitAgentRequest, settleAgentRequests } from '@/db/credits/agentRequests'
import { creditPeriodKey } from '@/db/credits/ledger'
import { creditsMeasurementReport } from '@/db/credits/report'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import type { PlatformTextOutcome } from '@/lib/whatsapp/platform/sendText'
import { enableDelivery, resetControls, readyOwner, insertReminder, row, T } from '../reminders/deliveryFixtures'

const ENV = { OWNER_PERSONAL_REMINDERS_SEND_ENABLED: '1', PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000009', PLATFORM_WHATSAPP_ACCESS_TOKEN: 'synthetic-test-token', CREDITS_METERING: '1' }
const CLEAR = [...Object.keys(ENV), 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_ENFORCE_ON_PRO', 'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_AUTOMATION_MONTHLY_USD_ALERT', 'AI_USAGE_LEDGER']
const MIN = 60_000
const PERIOD = () => creditPeriodKey(Date.now())
const OLD = () => new Date(Date.now() - 30 * MIN)
const sends = (o?: PlatformTextOutcome) => vi.fn(async (): Promise<PlatformTextOutcome> => o ?? { kind: 'sent', wamid: `wamid.acc.${Date.now()}.${Math.random()}` })
const tick = (send: ReturnType<typeof vi.fn>) => tickPersonalReminders({ send: send as never, nowMs: () => Date.now() })
type Owner = Awaited<ReturnType<typeof readyOwner>>

async function owner(name: string): Promise<Owner> {
  const o = await readyOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan: 'pro', planReason: 'manual:test' })
  return o
}
async function ai(o: Owner, kind: string, cost: number | null, over: Record<string, unknown> = {}) {
  const id = randomUUID()
  await db('ai_usage_events').insert({
    callId: randomUUID(), invocationId: id, operationKind: kind, operationId: id, agencyId: o.agencyId, userId: o.userId, feature: 'x', provider: 'openai', requestedModel: 'm', responseModel: 'm', chainIndex: 0, attempt: 1, stepIndex: 0, status: 'success',
    usageReported: cost !== null, inputTokens: 1, outputTokens: 1, costUsd: cost, costBasis: cost === null ? 'unknown' : 'reported_usage', priceVersion: 'test', currency: 'USD', createdAt: OLD(), ...over,
  })
}
const ledger = (agencyId: number) => db('agency_credit_ledger').where({ agencyId }).select('entryType', 'amountMillis', 'sourceKind')
const before = async () => creditsMeasurementReport(PERIOD())

beforeEach(async () => {
  Object.assign(process.env, ENV)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await enableDelivery()
  await db(T).whereIn('status', ['scheduled', 'claimed', 'dispatching']).update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: new Date(), finalizedAt: new Date() })
})
afterEach(() => {
  for (const k of CLEAR) delete process.env[k]
  vi.restoreAllMocks()
})
afterAll(async () => {
  await resetControls()
  await db.destroy()
})

describe('automation never touches the allowance or the wallet', () => {
  it.each(['auto_response_job', 'conversation_analysis_job', 'inbox.autoResponse', 'conversation.analysis', 'lead.summary'])('%s', async (kind) => {
    const o = await owner(`auto-${kind}`)
    await ai(o, kind, 0.5)
    await settleAgentRequests()
    expect(await ledger(o.agencyId)).toEqual([])
    expect(await db('agent_requests').where({ agencyId: o.agencyId })).toEqual([])
  })

  it('is measured apart from owner-initiated usage, and an alert can be raised without blocking anything', async () => {
    const o = await owner('auto-split')
    const a = await before()
    process.env.CREDITS_AUTOMATION_MONTHLY_USD_ALERT = String(a.automation.costUsd + 0.1)
    await ai(o, 'auto_response_job', 0.2)
    await ai(o, 'wa_assistant_job', 0.06)
    const b = await before()
    expect(b.automation.costUsd - a.automation.costUsd).toBeCloseTo(0.2, 6)
    expect(b.agent.costUsd - a.agent.costUsd).toBeCloseTo(0.06, 6)
    expect(b.automation.overAlert).toBe(true)
  })
})

describe('unknown cost is visible, not a reliable zero', () => {
  it('flags a successful call with no cost', async () => {
    const o = await owner('unknown-cost')
    await ai(o, 'auto_response_job', null)
    const r = await before()
    expect(r.automation.unknownCostCalls).toBeGreaterThanOrEqual(1)
    expect(r.reliable).toBe(false)
  })
  it('an unclassified kind is never charged and is named', async () => {
    const o = await owner('unclassified')
    await ai(o, 'brand_new_job', 0.3)
    await settleAgentRequests()
    expect(await ledger(o.agencyId)).toEqual([])
    const r = await before()
    expect(r.unclassified.kinds).toContain('brand_new_job')
    expect(r.reliable).toBe(false)
  })
})

describe('founder usage is reported apart', () => {
  it('requests of the entitled user are counted as exempt', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    const o = await owner('rep-founder')
    await db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.userId, entitlement: 'founder_unlimited_usage', reason: 'test', grantedBy: 'test' })
    const a = await before()
    await admitAgentRequest({ agencyId: o.agencyId, userId: o.userId, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id: 'fr1' }, nowMs: OLD().getTime() })
    await ai(o, 'wa_assistant_job', 0.03, { operationId: 'fr1' })
    await settleAgentRequests()
    const b = await before()
    expect(b.founderExempt.operations - a.founderExempt.operations).toBe(1)
    expect(b.founderExempt.costUsd - a.founderExempt.costUsd).toBeCloseTo(0.03, 6)
    expect(b.requests.exempt - a.requests.exempt).toBe(1)
  })
})

describe('reminders: real gate, no credit ever', () => {
  it('a delivered reminder writes no ledger row and its Meta cost is reported separately', async () => {
    const o = await owner('rem-sent')
    const a = await before()
    await insertReminder(o, 'scheduled')
    const send = sends()
    await tick(send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(await db('agency_credit_ledger').where({ agencyId: o.agencyId })).toEqual([])
    const b = await before()
    expect(b.whatsapp.reminders - a.whatsapp.reminders).toBe(1)
    expect(b.whatsapp.rateCardUsd).toBeGreaterThan(a.whatsapp.rateCardUsd)
    expect(b.agent.calls).toBe(a.agent.calls)
  })

  it('a retry delivers once and counts the delivery once', async () => {
    const o = await owner('rem-retry')
    const a = await before()
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'rejected', scope: 'rate_limit', code: '131056', httpStatus: 429 }))
    await db(T).where({ id: r.id }).update({ nextAttemptAt: new Date(Date.now() - MIN) })
    await tick(sends())
    expect((await row(r.id)).status).toBe('sent')
    expect((await before()).whatsapp.reminders - a.whatsapp.reminders).toBe(1)
    expect(await ledger(o.agencyId)).toEqual([])
  })

  it('a definite rejection counts no Meta cost', async () => {
    const o = await owner('rem-reject')
    const a = await before()
    const r = await insertReminder(o, 'scheduled')
    await tick(sends({ kind: 'rejected', scope: 'recipient', code: '131026', httpStatus: 400 }))
    expect((await row(r.id)).status).toBe('failed')
    expect((await before()).whatsapp.reminders).toBe(a.whatsapp.reminders)
  })

  it('an exhausted allowance never blocks a reminder', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    process.env.CREDITS_ENFORCE_ON_PRO = '1'
    const o = await owner('rem-empty')
    process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = String(o.agencyId)
    const admit = (id: string) => admitAgentRequest({ agencyId: o.agencyId, userId: o.userId, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id } })
    await admit('a')
    expect(await admit('b')).toMatchObject({ allowed: false })
    const r = await insertReminder(o, 'scheduled')
    const send = sends()
    await tick(send)
    expect(send).toHaveBeenCalledTimes(1)
    expect((await row(r.id)).status).toBe('sent')
  })
})
