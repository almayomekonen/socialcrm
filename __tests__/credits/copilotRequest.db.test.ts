/**
 * Copilot under the same allowance and credits as the Agent. Real Postgres;
 * no provider call. `server-only` is stubbed by the test setup.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { admitAgentRequest, settleAgentRequests } from '@/db/credits/agentRequests'
import { creditPeriodKey, insertEntry } from '@/db/credits/ledger'
import { aiUsageCategory } from '@/lib/credits/aiCategories'
import { COPILOT_OPERATION_KIND, runCopilotRequest } from '@/lib/credits/copilotRequest'
import { currentAiOperation } from '@/lib/ai/usage/context'
import { seedOwner } from '../reminders/fixtures'

const CLEAR = ['CREDITS_METERING', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_ENFORCE_ON_PRO', 'AI_USAGE_LEDGER']
type Owner = Awaited<ReturnType<typeof seedOwner>>

async function owner(name: string, enforce = true): Promise<Owner> {
  const o = await seedOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan: 'free' })
  if (enforce) process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = String(o.agencyId)
  return o
}
const user = (o: Owner) => ({ id: o.userId, agencyId: o.agencyId })
const rows = (o: Owner) => db('agent_requests').where({ agencyId: o.agencyId }).orderBy('id').select('*') as Promise<Record<string, any>[]>
const blocked = () => 'blocked'
const grant = (o: Owner, credits: number) => insertEntry(db, { agencyId: o.agencyId, entryType: 'purchase_grant', amountMillis: credits * 1000, periodKey: creditPeriodKey(Date.now()), idempotencyKey: `charge:${randomUUID()}`, sourceKind: 'billing_charge', sourceId: '1' })

beforeEach(() => {
  process.env.CREDITS_METERING = '1'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of CLEAR) delete process.env[k]
  vi.restoreAllMocks()
})
afterAll(async () => {
  await db.destroy()
})

describe('a Copilot question', () => {
  it('counts as one request, and its model calls belong to that request', async () => {
    const o = await owner('__cop_one__')
    const seen = await runCopilotRequest<unknown>(user(o), blocked, async () => currentAiOperation())
    const [row, ...rest] = await rows(o)
    expect(rest).toHaveLength(0)
    expect(row.operationKind).toBe(COPILOT_OPERATION_KIND)
    expect(row.tier).toBe('free')
    expect(seen).toMatchObject({ kind: COPILOT_OPERATION_KIND, id: row.operationId, agencyId: o.agencyId, userId: o.userId })
  })

  it('a question that answers through a second path is still one request', async () => {
    const o = await owner('__cop_nested__')
    const out = await runCopilotRequest(user(o), blocked, () => runCopilotRequest(user(o), blocked, async () => 'answered'))
    expect(out).toBe('answered')
    expect(await rows(o)).toHaveLength(1)
  })

  it('draws from the same 50 as the Agent: the Agent\'s requests leave fewer, and neither counts the other', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '2'
    const o = await owner('__cop_shared__')
    await admitAgentRequest({ agencyId: o.agencyId, userId: o.userId, source: 'web', operation: { kind: 'agent_investigation', id: randomUUID() }, nowMs: Date.now() })
    expect(await runCopilotRequest(user(o), blocked, async () => 'answered')).toBe('answered')
    const run = vi.fn(async () => 'answered')
    expect(await runCopilotRequest(user(o), blocked, run)).toBe('blocked')
    expect(run).not.toHaveBeenCalled()
    expect((await rows(o)).filter((r) => r.tier === 'free')).toHaveLength(2)
  })

  it('with no credits left runs no model, and with credits takes the paid path', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('__cop_paid__')
    await runCopilotRequest(user(o), blocked, async () => 'answered')
    const run = vi.fn(async () => 'answered')
    expect(await runCopilotRequest(user(o), blocked, run)).toBe('blocked')
    expect(run).not.toHaveBeenCalled()
    await grant(o, 10)
    expect(await runCopilotRequest(user(o), blocked, run)).toBe('answered')
    expect((await rows(o)).at(-1)!.tier).toBe('paid')
  })

  it('an agency not under enforcement is measured, never stopped', async () => {
    process.env.CREDITS_MONTHLY_ALLOWANCE = '1'
    const o = await owner('__cop_measured__', false)
    await runCopilotRequest(user(o), blocked, async () => 'answered')
    expect(await runCopilotRequest(user(o), blocked, async () => 'answered')).toBe('answered')
  })

  it('a request that called no model settles void and gives the allowance back', async () => {
    process.env.AI_USAGE_LEDGER = '1'
    const o = await owner('__cop_void__')
    const past = new Date(Date.now() - 30 * 60_000)
    await runCopilotRequest(user(o), blocked, async () => 'cached')
    await db('agent_requests').where({ agencyId: o.agencyId }).update({ createdAt: past })
    await settleAgentRequests()
    expect((await rows(o))[0].tier).toBe('void')
  })

  it('is classified as Agent usage, not automation', () => {
    expect(aiUsageCategory(COPILOT_OPERATION_KIND)).toBe('agent')
  })
})
