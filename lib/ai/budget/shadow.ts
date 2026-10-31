import { createHash, randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { reserveShadow, settleShadow } from '@/db/aiBudget'
import { currentAiOperation } from '@/lib/ai/usage/context'
import { PRICE_VERSION, priceUsage, type CostVerdict, type UsageTokens } from '@/lib/ai/usage/pricing'
import { budgetPolicyFor, isAiBudgetShadowEnabled, type BudgetPolicy } from './policy'
import { emitBudgetEvent, failureReason } from './events'
import { keepAliveUntilDone } from '@/lib/ai/lifecycle'

export { keepAliveUntilDone }
import type { BudgetEstimate } from './estimate'

/**
 * SHADOW budget evaluation around ONE provider request. A SIMULATION, not
 * protection: it records what an enforcing budget would have decided.
 *
 *   startShadow   is called immediately before the provider request and is
 *                 NOT awaited — the reservation runs concurrently, so the
 *                 request is never delayed, blocked or changed;
 *   settleShadow… starts immediately after the request and is awaited for at
 *                 most SETTLE_WAIT_MS. The same work is handed to Next's
 *                 `after()`, so inside a request (route handler, server
 *                 action, cron route) the platform keeps the function alive
 *                 until it finishes (Vercel `waitUntil`, up to the route's
 *                 maxDuration). It is retried a few times — database work
 *                 only, never a provider call.
 *
 * SETTLEMENT IS RECOVERABLE, NOT GUARANTEED. A crash, a timeout at
 * maxDuration, a database outage longer than the retries, or a caller outside
 * any request scope (no lifecycle to extend) can still leave a reservation
 * `reserved`. The expiry sweep (`expireStaleShadowReservations`, cron) then
 * settles it idempotently: from its usage-ledger row when one shares its
 * callId, otherwise as `expired` / unknown, charged its estimate.
 *
 * RUN IDENTITY. Every reservation belongs to a logical run: the worker's
 * `withAiOperation` context when there is one (a job), otherwise the caller's
 * `run` (a router invocation, an Agent investigation, a transcription). The
 * same identity the usage ledger records. Without either, the run scope is
 * skipped and recorded as such — never a fresh per-call "run".
 *
 * The settled actual keeps its cost basis (reported / estimated / unknown).
 * Callers that also write ledger rows pass the SAME verdict they recorded
 * (`verdictForCall` / `combineVerdicts`), so a reservation equals the sum of
 * its ledger rows, and the reservation stores its own link to them
 * (invocationId + step range) so it stays reconcilable with the ledger off.
 *
 * Every failure is swallowed — never retried as, or turned into, another
 * provider call — and reported as a structured log event (`./events`), not
 * in the database that may be what failed. Identity comes from
 * the server: the caller's server-derived agency id and the worker's
 * `withAiOperation` context; the contact is a one-way hash read from the
 * agency's own conversation row, never a raw number.
 */

const SETTLE_WAIT_MS = 250
/** Delays before each settlement attempt (database work only — idempotent). */
const SETTLE_RETRY_DELAYS_MS = [0, 100, 400]

export type ShadowRequest = {
  callId: string
  agencyId?: number | null
  conversationId?: number | null
  leadId?: number | null
  feature: string
  provider: string
  model: string
  /** The usage ledger's invocation id for this request. */
  invocationId?: string | null
  /** The logical run, when no worker operation context is active (server-generated ids only). */
  run?: { kind: string; id: string } | null
  /** May be async (e.g. measuring a schema); it runs off the request path either way. */
  estimate: (policy: BudgetPolicy) => BudgetEstimate | Promise<BudgetEstimate>
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

/** The handle of a request shadow mode did not track (flag off): settling it is a no-op, with no lifecycle work. */
const NO_SHADOW: ShadowHandle = Promise.resolve(null)

export function startShadow(req: ShadowRequest): ShadowHandle {
  if (!isAiBudgetShadowEnabled()) return NO_SHADOW
  const op = currentAiOperation()
  const agencyId = req.agencyId ?? op?.agencyId ?? null
  const run = op?.id ? { kind: op.kind, id: op.id } : (req.run ?? null)
  const ids = {
    callId: req.callId,
    invocationId: req.invocationId ?? null,
    operationKind: run?.kind ?? op?.kind ?? req.feature,
    operationId: run?.id ?? null,
    feature: req.feature,
    provider: req.provider,
    model: req.model,
    agencyId,
  }
  if (!run) emitBudgetEvent('run_identity_missing', ids)
  return (async () => {
    let stage: 'estimate' | 'database' = 'estimate'
    try {
      const conversationId = req.conversationId ?? op?.conversationId ?? null
      const leadId = req.leadId ?? op?.leadId ?? null
      const policy = budgetPolicyFor(agencyId)
      const estimate = await req.estimate(policy)
      stage = 'database'
      await reserveShadow({
        callId: req.callId,
        policy,
        agencyId,
        operationKind: run?.kind ?? op?.kind ?? req.feature,
        operationId: run?.id ?? null,
        conversationId,
        contactKey: await contactKeyFor(agencyId, conversationId, leadId),
        feature: req.feature,
        provider: req.provider,
        model: req.model,
        estimate,
        estimatePriceVersion: estimate.basis === 'unbounded' ? null : PRICE_VERSION,
        invocationId: req.invocationId ?? null,
        now: new Date(),
      })
      return { callId: req.callId }
    } catch (err) {
      // No reservation row exists for this request; the provider call goes ahead untouched.
      emitBudgetEvent('reservation_failed', { ...ids, stage, reason: failureReason(err, stage), error: err })
      return null
    }
  })()
}

export type ShadowOutcome = {
  outcome: 'success' | 'error'
  usage: UsageTokens | null
  models: { requested: string; response?: string | null }
  webSearchCalls?: number
  serviceTier?: string | null
  /** For non-token billing (audio minutes): the estimated actual, when known. */
  knownCostUsd?: number | null
  /** The cost already priced by the caller (preferred: the verdict its ledger rows used). */
  verdict?: CostVerdict
  responseModels?: string[]
  /** The ledger rows covered: stepIndex in [stepIndexFrom, stepIndexFrom + stepCount). */
  stepIndexFrom?: number
  stepCount?: number
}

function actualOf(o: ShadowOutcome): CostVerdict {
  if (o.verdict) return o.verdict
  if (o.knownCostUsd !== undefined) {
    return o.knownCostUsd != null && Number.isFinite(o.knownCostUsd)
      ? { costUsd: o.knownCostUsd, costBasis: 'estimated', costNote: 'duration_estimate', priceVersion: null }
      : { costUsd: null, costBasis: 'unknown', costNote: 'usage_missing', priceVersion: PRICE_VERSION }
  }
  return priceUsage(o.models, o.usage, { webSearchCalls: o.webSearchCalls, serviceTier: o.serviceTier })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Settle with retries. Never throws; a final failure is left for the expiry sweep. */
async function settleWithRetry(handle: ShadowHandle, o: ShadowOutcome): Promise<void> {
  const h = await handle
  if (!h) return
  const v = actualOf(o)
  const input = {
    callId: h.callId,
    outcome: o.outcome,
    actualUsd: v.costUsd,
    costBasis: v.costBasis,
    costNote: v.costNote,
    priceVersion: v.priceVersion,
    responseModels: o.responseModels ?? (o.models.response ? [o.models.response] : []),
    stepIndexFrom: o.stepIndexFrom ?? null,
    stepCount: o.stepCount ?? null,
  }
  let last: unknown
  for (const delay of SETTLE_RETRY_DELAYS_MS) {
    if (delay) await sleep(delay)
    try {
      await settleShadow(input) // idempotent: a repeat after a lost reply changes nothing
      return
    } catch (err) {
      last = err
    }
  }
  emitBudgetEvent('settlement_failed', {
    callId: h.callId,
    stage: 'database',
    reason: failureReason(last, 'database'),
    attempts: SETTLE_RETRY_DELAYS_MS.length,
    error: last,
  })
}

export async function settleShadowAfter(handle: ShadowHandle, o: ShadowOutcome): Promise<void> {
  if (handle === NO_SHADOW) return // shadow off: nothing to settle, no after() task
  const work = settleWithRetry(handle, o).catch(() => undefined)
  keepAliveUntilDone(work)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([work, new Promise<void>((r) => (timer = setTimeout(r, SETTLE_WAIT_MS)))])
  clearTimeout(timer)
}
