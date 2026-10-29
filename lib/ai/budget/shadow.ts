import { createHash, randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { reserveShadow, settleShadow } from '@/db/aiBudget'
import { currentAiOperation } from '@/lib/ai/usage/context'
import { priceUsage, type UsageTokens } from '@/lib/ai/usage/pricing'
import { budgetPolicyFor, isAiBudgetShadowEnabled, type BudgetPolicy } from './policy'
import type { BudgetEstimate } from './estimate'

/**
 * SHADOW budget evaluation around ONE provider request. A SIMULATION, not
 * protection: it records what an enforcing budget would have decided.
 *
 *   startShadow   is called immediately before the provider request and is
 *                 NOT awaited — the reservation runs concurrently, so the
 *                 request is never delayed, blocked or changed;
 *   settleShadow… is awaited after the request for at most SETTLE_WAIT_MS,
 *                 then left to finish in the background.
 *
 * Every failure is swallowed (logged by error name only). Identity comes from
 * the server: the caller's server-derived agency id and the worker's
 * `withAiOperation` context; the contact is a one-way hash read from the
 * agency's own conversation row, never a raw number.
 */

const SETTLE_WAIT_MS = 250

export type ShadowRequest = {
  callId: string
  agencyId?: number | null
  conversationId?: number | null
  leadId?: number | null
  feature: string
  provider: string
  model: string
  estimate: (policy: BudgetPolicy) => BudgetEstimate
}

export type ShadowHandle = Promise<{ callId: string } | null>

export const newCallId = (): string => randomUUID()

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

/** A stable, non-reversible contact identity, or null when none is reliably known. */
export async function contactKeyFor(
  agencyId: number | null,
  conversationId: number | null,
  leadId: number | null,
): Promise<string | null> {
  if (agencyId == null) return null
  if (conversationId != null) {
    const row = (await db('inbox_conversations').where({ id: conversationId, agencyId }).first('customerWaId')) as
      | { customerWaId?: string | null }
      | undefined
    if (row?.customerWaId) return hash(`wa:${agencyId}:${row.customerWaId}`)
  }
  return leadId != null ? hash(`lead:${agencyId}:${leadId}`) : null
}

export function startShadow(req: ShadowRequest): ShadowHandle {
  if (!isAiBudgetShadowEnabled()) return Promise.resolve(null)
  const op = currentAiOperation()
  return (async () => {
    try {
      const agencyId = req.agencyId ?? op?.agencyId ?? null
      const conversationId = req.conversationId ?? op?.conversationId ?? null
      const leadId = req.leadId ?? op?.leadId ?? null
      const policy = budgetPolicyFor(agencyId)
      await reserveShadow({
        callId: req.callId,
        policy,
        agencyId,
        operationKind: op?.kind ?? req.feature,
        operationId: op?.id ?? null,
        conversationId,
        contactKey: await contactKeyFor(agencyId, conversationId, leadId),
        feature: req.feature,
        provider: req.provider,
        model: req.model,
        estimate: req.estimate(policy),
        now: new Date(),
      })
      return { callId: req.callId }
    } catch (err) {
      console.error('[ai-budget] shadow reserve failed', { name: (err as Error)?.name ?? 'error' })
      return null
    }
  })()
}

export type ShadowOutcome = {
  outcome: 'success' | 'error'
  usage: UsageTokens | null
  models: { requested: string; response?: string | null }
  webSearchCalls?: number
  /** For non-token billing (audio minutes): the estimated actual, when known. */
  knownCostUsd?: number | null
}

export async function settleShadowAfter(handle: ShadowHandle, o: ShadowOutcome): Promise<void> {
  const work = (async () => {
    const h = await handle
    if (!h) return
    const actualUsd =
      o.knownCostUsd !== undefined ? o.knownCostUsd : priceUsage(o.models, o.usage, { webSearchCalls: o.webSearchCalls }).costUsd
    await settleShadow({ callId: h.callId, outcome: o.outcome, actualUsd })
  })().catch((err) => console.error('[ai-budget] shadow settle failed', { name: (err as Error)?.name ?? 'error' }))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([work, new Promise<void>((r) => (timer = setTimeout(r, SETTLE_WAIT_MS)))])
  clearTimeout(timer)
}
