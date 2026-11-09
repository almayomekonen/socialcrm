/**
 * Every user-triggered Copilot path stops before any model call when the
 * allowance and credits are used up, and the Copilot allowlist is not involved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  admit: vi.fn(),
  runStructured: vi.fn(),
  user: { id: 7, agencyId: 70, role: 'ADMIN' },
}))
vi.mock('@/db/credits/agentRequests', () => ({ admitAgentRequest: h.admit }))
vi.mock('@/lib/ai/router', () => ({ runStructured: h.runStructured }))
vi.mock('@/lib/requireUser', () => ({ requireProductAccess: async () => h.user, requireAgencyUser: async () => h.user, ProductAccessError: class extends Error {} }))
vi.mock('next/cache', () => ({ unstable_cache: (f: unknown) => f, revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/db/aiSummaries', () => ({ getLeadIntelligenceInputs: async () => ({ inputs: {} }) }))
vi.mock('@/db/clients', async (orig) => ({ ...(await orig<object>()), getFullLead: async () => ({ name: 'דני' }) }))
vi.mock('@/lib/copilot/persistConversation', () => ({ persistAssistantTurn: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(async () => undefined) }))

import { z } from 'zod'
import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import { askLeadQuestion } from '@/actions/ai/leadAskQuestion'
import { generateLeadFollowupMessage } from '@/actions/ai/leadFollowup'
import { generateLeadNextBestStep } from '@/actions/ai/leadNextStep'
import { defineCachedLeadAction, type CachedLeadActionConfig } from '@/actions/ai/_defineCachedLeadAction'
import { currentAiOperation } from '@/lib/ai/usage/context'
import { COPILOT_LIMIT_NOTE } from '@/lib/credits/copilotRequest'

const DENIED = { allowed: false, reason: 'credits_required', notice: 'full' }

function action(over: Partial<CachedLeadActionConfig<{ a: number }>> = {}) {
  return defineCachedLeadAction<{ a: number }>({
    kind: 'lead.followup',
    schema: z.object({ a: z.number() }) as never,
    schemaName: 's',
    schemaDescription: 'd',
    system: 'x',
    buildUserMessage: () => 'x',
    sanitize: (o) => ({ result: o, report: { polluted: false, fields: [] } }),
    cache: { keyPrefix: `t${Math.random()}`, ttlSeconds: 1, tags: () => [] },
    requiresLeadName: false,
    pollutionLogPrefix: 't',
    ...over,
  })
}

beforeEach(() => {
  h.admit.mockReset()
  h.runStructured.mockReset()
})

describe('when the allowance and credits are used up', () => {
  beforeEach(() => h.admit.mockResolvedValue(DENIED))

  it('the general question path stops and says why', async () => {
    expect(await askGeneralQuestion('כמה לידים יש לי')).toEqual({ kind: 'guide', answer: COPILOT_LIMIT_NOTE })
    expect(h.runStructured).not.toHaveBeenCalled()
  })
  it('the lead question path stops before classifying', async () => {
    expect(await askLeadQuestion(5, 'מה המצב של הליד הזה ואיך כדאי להמשיך', [])).toEqual({ ok: false, reason: 'ai-credits-exhausted' })
    expect(h.runStructured).not.toHaveBeenCalled()
  })
  it('the follow-up and next-step buttons stop', async () => {
    expect(await generateLeadFollowupMessage(5)).toEqual({ ok: false, reason: 'ai-credits-exhausted' })
    expect(await generateLeadNextBestStep(5)).toEqual({ ok: false, reason: 'ai-credits-exhausted' })
    expect(h.runStructured).not.toHaveBeenCalled()
  })
  it('a storage failure stops too, rather than giving a free answer', async () => {
    h.admit.mockResolvedValue({ allowed: false, reason: 'unavailable', notice: null })
    expect(await generateLeadFollowupMessage(5)).toEqual({ ok: false, reason: 'ai-credits-exhausted' })
    expect(h.runStructured).not.toHaveBeenCalled()
  })
})

describe('when admitted', () => {
  it('admits once as a web Copilot request, and the model call runs inside it', async () => {
    h.admit.mockResolvedValue({ allowed: true, tier: 'free' })
    let during: ReturnType<typeof currentAiOperation>
    h.runStructured.mockImplementation(async () => {
      during = currentAiOperation()
      return { ok: true, data: { a: 1 }, provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 }
    })
    const out = await action({ countsAsCopilotRequest: true })(5)
    expect(out.ok).toBe(true)
    expect(h.admit).toHaveBeenCalledOnce()
    const input = h.admit.mock.calls[0][0]
    expect(input).toMatchObject({ agencyId: 70, userId: 7, source: 'web', operation: { kind: 'copilot_request' } })
    expect(during).toMatchObject({ kind: 'copilot_request', id: input.operation.id })
  })

  it('lead intelligence, which no one presses a button for, is not counted', async () => {
    h.runStructured.mockResolvedValue({ ok: true, data: { a: 1 }, provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 })
    await action()(5)
    expect(h.admit).not.toHaveBeenCalled()
  })
})
