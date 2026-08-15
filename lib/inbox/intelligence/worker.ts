import { randomUUID } from 'crypto'
import {
  INTEL_KIND_ACTION,
  INTEL_KIND_INTENT,
  INTEL_KIND_SUMMARY,
  INTEL_KIND_TEMPERATURE,
  claimAnalysisJobs,
  completeAnalysisJob,
  conversationIntelligenceTag,
  failAnalysisJob,
  getAnalysisConversationContext,
  getIntelligenceCoverage,
  getMaxMessageSequence,
  insertIntelligenceRun,
  listMessagesForAnalysis,
  markAnalysisJobFailedTerminal,
  markIntelligenceFailed,
  reclaimStaleAnalysisJobs,
  refreshIntelligenceCoverage,
  upsertManyConversationIntelligence,
  type ConversationAnalysisJob,
  type UpsertIntelligenceInput,
} from '@/db/conversationIntelligence'
import {
  ANALYZER_SCHEMA_VERSION,
  ANALYZER_VERSION,
  hashAnalysisInput,
  promptVersion,
  runConversationAnalyzer,
  type ConversationAnalyzerSuccess,
} from './conversationAnalyzer'
import { notifyEvent } from '@/lib/notifications/emit'

/**
 * Conversation analysis worker (Phase 3). Drains the durable job queue with
 * SKIP LOCKED and runs ONE composite AI call per job (summary + intent +
 * temperature + suggested action) through runStructured, which owns the
 * provider fallback chain, agency spend caps, cost tracking and attempt
 * logging. The worker adds: idempotency (coverage + input-hash skip),
 * lease/crash safety, retry with backoff, dead-letter, run history and cache
 * revalidation. The suggested action is persisted as a recommendation only —
 * nothing executes it, no CRM records change, no tasks are created.
 *
 * Results persist as separate kinds (atomically), so each can evolve its own
 * schema/consumers, while the run record stays one-per-call to keep cost
 * accounting accurate.
 *
 * `revalidate` is injected so the route handler passes next/cache's revalidateTag
 * while tests pass a spy — the worker stays runnable outside the Next runtime.
 */

const ALL_KINDS = [INTEL_KIND_SUMMARY, INTEL_KIND_INTENT, INTEL_KIND_TEMPERATURE, INTEL_KIND_ACTION]

/** Composite run record kind — one row per AI call, carrying the full cost. */
const RUN_KIND = 'analysis'

// AI calls take seconds; keep the batch small enough to finish within the route's
// maxDuration. The cron runs every minute, so throughput is limit/minute.
const DEFAULT_LIMIT = 5
const DEFAULT_LEASE_MS = 2 * 60 * 1000

export type WorkerDeps = { revalidate?: (tag: string) => void }

export type WorkerOptions = {
  limit?: number
  workerId?: string
  leaseMs?: number
  deps?: WorkerDeps
}

export type WorkerRunResult = {
  reclaimed: number
  claimed: number
  done: number
  skipped: number
  retried: number
  dead: number
  terminal: number
}

export async function runConversationAnalysisWorker(opts: WorkerOptions = {}): Promise<WorkerRunResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const workerId = opts.workerId ?? `worker-${randomUUID()}`
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const revalidate = opts.deps?.revalidate

  const result: WorkerRunResult = { reclaimed: 0, claimed: 0, done: 0, skipped: 0, retried: 0, dead: 0, terminal: 0 }

  result.reclaimed = await reclaimStaleAnalysisJobs(leaseMs)

  const jobs = await claimAnalysisJobs(workerId, limit)
  result.claimed = jobs.length

  for (const job of jobs) {
    try {
      await processJob(job, result, revalidate)
    } catch (err) {
      // Last-resort guard: an unexpected error must never crash the drain loop.
      const msg = (err as Error)?.message ?? 'unknown-worker-error'
      const outcome = await failAnalysisJob(job, msg)
      if (outcome.dead) {
        result.dead++
        await deadLetter(job, msg, revalidate)
      } else {
        result.retried++
      }
    }
  }

  return result
}

async function processJob(
  job: ConversationAnalysisJob,
  result: WorkerRunResult,
  revalidate?: (tag: string) => void,
): Promise<void> {
  const startedAt = Date.now()
  const targetSequence = await getMaxMessageSequence(job.conversationId)

  // The summary row is the representative for coverage checks: all kinds are
  // written atomically in one transaction, so its state reflects the whole set.
  const coverage = await getIntelligenceCoverage(job.conversationId, INTEL_KIND_SUMMARY)
  const versionsMatch = coverage?.analyzerVersion === ANALYZER_VERSION && coverage?.promptVersion === promptVersion

  // Idempotency: a fresh, same-version result that already covers everything.
  if (coverage && coverage.status === 'fresh' && coverage.coveredSequence >= targetSequence && versionsMatch) {
    await completeAnalysisJob(job.id)
    result.skipped++
    return
  }

  const messages = await listMessagesForAnalysis(job.conversationId, job.agencyId)

  // Cost control: sequence advanced but the analyzed window is byte-identical
  // (e.g. media-only messages) — re-mark fresh without an AI call.
  if (coverage && versionsMatch && coverage.inputHash && coverage.inputHash === hashAnalysisInput(messages)) {
    await refreshIntelligenceCoverage(job.conversationId, ALL_KINDS, targetSequence)
    await completeAnalysisJob(job.id)
    result.skipped++
    revalidate?.(conversationIntelligenceTag(job.conversationId))
    return
  }

  const ctx = await getAnalysisConversationContext(job.conversationId, job.agencyId)
  if (!ctx) {
    await markAnalysisJobFailedTerminal(job.id, 'conversation-not-found')
    result.terminal++
    return
  }

  // Leadless / personal conversations are never sales conversations.
  // Complete without an AI call and without emitting lead.hot.
  if (ctx.leadId == null) {
    await completeAnalysisJob(job.id)
    result.skipped++
    return
  }

  // ONE composite AI call. runStructured enforces the agency allowlist + daily
  // spend cap, walks the provider fallback chain and logs every attempt.
  const out = await runConversationAnalyzer({
    conversationId: job.conversationId,
    agencyId: job.agencyId,
    leadId: ctx.leadId,
    channel: ctx.channel,
    leadName: ctx.leadName,
    leadStatus: ctx.leadStatus,
    customerName: ctx.customerName,
    messages,
  })

  if (out.ok === false) {
    await insertIntelligenceRun({
      conversationId: job.conversationId,
      agencyId: job.agencyId,
      jobId: job.id,
      kind: RUN_KIND,
      success: false,
      analyzerVersion: ANALYZER_VERSION,
      schemaVersion: ANALYZER_SCHEMA_VERSION,
      coveredSequence: targetSequence,
      latencyMs: Date.now() - startedAt,
      errorReason: out.reason,
    })

    if (!out.retryable) {
      // Config/permission states (disabled, forbidden, no-providers, empty
      // conversation): retrying cannot help. Fail terminally without marking the
      // conversation's intelligence as failed — for a non-AI agency the Inbox
      // should simply show nothing.
      await markAnalysisJobFailedTerminal(job.id, out.reason)
      result.terminal++
      return
    }

    const outcome = await failAnalysisJob(job, out.reason)
    if (outcome.dead) {
      result.dead++
      await deadLetter(job, out.reason, revalidate)
    } else {
      result.retried++
    }
    return
  }

  await upsertManyConversationIntelligence(buildIntelligenceRows(job, out, targetSequence))

  /**
   * lead.hot — the notification engine's unsolicited save (notification spec
   * §4.1, care-charter Law 18). Emitted HERE because this is the moment "this
   * lead is hot" becomes true in the database; the analyzer's temperature row is
   * the only place that fact exists.
   *
   * No actor: the analyzer is not a person, so nobody is dropped as
   * self-authored and the assigned נציג hears about it.
   *
   * No change-detection needed. The event key is once-ever per lead, so
   * re-analysis that still says 'hot' is absorbed by the unique index rather
   * than notifying twice — a lead does not become newsworthy again because the
   * analyzer ran again. notifyEvent never throws, so this cannot affect the
   * analysis job's own bookkeeping below.
   */
  if (out.temperature.temperature === 'hot') {
    await notifyEvent({
      type: 'lead.hot',
      agencyId: job.agencyId,
      entityType: 'lead',
      entityId: ctx.leadId,
      actorUserId: null,
      occurredAt: new Date(),
      payload: { leadName: ctx.leadName },
    })
  }

  // One run record per AI call (composite kind) — keeps SUM(costUsd) accurate.
  await insertIntelligenceRun({
    conversationId: job.conversationId,
    agencyId: job.agencyId,
    jobId: job.id,
    kind: RUN_KIND,
    success: true,
    analyzerVersion: ANALYZER_VERSION,
    schemaVersion: ANALYZER_SCHEMA_VERSION,
    modelProvider: out.modelProvider,
    modelId: out.modelId,
    coveredSequence: targetSequence,
    inputHash: out.inputHash,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    costUsd: out.costUsd,
    latencyMs: Date.now() - startedAt,
    data: {
      summary: out.summary.summary,
      intent: out.intent.intent,
      temperature: out.temperature.temperature,
      suggestedAction: out.action.suggestedAction,
    },
  })

  await completeAnalysisJob(job.id)
  result.done++
  revalidate?.(conversationIntelligenceTag(job.conversationId))
}

function buildIntelligenceRows(
  job: ConversationAnalysisJob,
  out: ConversationAnalyzerSuccess,
  targetSequence: number,
): UpsertIntelligenceInput[] {
  const base = {
    conversationId: job.conversationId,
    agencyId: job.agencyId,
    channel: job.channel,
    status: 'fresh' as const,
    schemaVersion: ANALYZER_SCHEMA_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    promptVersion,
    modelProvider: out.modelProvider,
    modelId: out.modelId,
    coveredSequence: targetSequence,
    inputHash: out.inputHash,
    lastError: null,
  }

  return [
    // Tokens/cost live on the summary row only — the call is shared, and
    // attributing it once keeps SUM(costUsd) over the table accurate.
    {
      ...base,
      kind: INTEL_KIND_SUMMARY,
      data: out.summary,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      costUsd: out.costUsd,
    },
    { ...base, kind: INTEL_KIND_INTENT, data: { intent: out.intent.intent }, confidence: out.intent.confidence },
    {
      ...base,
      kind: INTEL_KIND_TEMPERATURE,
      data: { temperature: out.temperature.temperature },
      confidence: out.temperature.confidence,
    },
    {
      ...base,
      kind: INTEL_KIND_ACTION,
      data: {
        suggestedAction: out.action.suggestedAction,
        reason: out.action.reason,
        actionMessage: out.action.actionMessage,
        noveltyKind: out.action.noveltyKind,
        sourceMessageIds: out.action.sourceMessageIds,
      },
      confidence: out.action.confidence,
    },
  ]
}

async function deadLetter(
  job: ConversationAnalysisJob,
  error: string,
  revalidate?: (tag: string) => void,
): Promise<void> {
  await markIntelligenceFailed(
    job.conversationId,
    job.agencyId,
    job.channel,
    ALL_KINDS,
    ANALYZER_VERSION,
    ANALYZER_SCHEMA_VERSION,
    error,
  )
  revalidate?.(conversationIntelligenceTag(job.conversationId))
}
