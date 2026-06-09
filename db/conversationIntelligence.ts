import type { Knex } from 'knex'
import { db } from '@/config/db'

export const conversationIntelligenceTag = (conversationId: number): string => `conv-intel:${conversationId}`

/**
 * Intelligence kinds produced by the composite analyzer. Shared constants live
 * here (not in the analyzer) so render-path code never imports AI modules.
 */
export const INTEL_KIND_SUMMARY = 'summary'
export const INTEL_KIND_INTENT = 'intent'
export const INTEL_KIND_TEMPERATURE = 'temperature'
export const INTEL_KIND_ACTION = 'suggested_action'

export type AnalysisJobStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead'
export type AnalysisJobReason = 'new_message' | 'manual' | 'version_bump' | 'backfill'
export type IntelligenceStatus = 'fresh' | 'stale' | 'failed'

export type ConversationAnalysisJob = {
  id: number
  conversationId: number
  agencyId: number
  channel: string
  reason: AnalysisJobReason
  triggerSequence: number
  status: AnalysisJobStatus
  attempts: number
  maxAttempts: number
}

const DEBOUNCE_MS = Number(process.env.CONVERSATION_ANALYSIS_DEBOUNCE_MS ?? 15000)
const BACKOFF_BASE_MS = Number(process.env.CONVERSATION_ANALYSIS_BACKOFF_MS ?? 30000)
const BACKOFF_MAX_MS = 15 * 60 * 1000

export type EnqueueConversationAnalysisInput = {
  conversationId: number
  agencyId: number
  channel: string
  triggerSequence: number
  reason?: AnalysisJobReason
}

export async function enqueueConversationAnalysis(trx: Knex.Transaction, input: EnqueueConversationAnalysisInput): Promise<void> {
  const reason: AnalysisJobReason = input.reason ?? 'new_message'
  const notBefore = new Date(Date.now() + DEBOUNCE_MS)

  await trx.raw(
    `
    INSERT INTO conversation_analysis_jobs
      ("conversationId", "agencyId", channel, reason, "triggerSequence", status, "notBefore")
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT ("conversationId") WHERE status = 'pending'
    DO UPDATE SET
      "triggerSequence" = GREATEST(EXCLUDED."triggerSequence", conversation_analysis_jobs."triggerSequence"),
      "notBefore" = EXCLUDED."notBefore",
      reason = EXCLUDED.reason,
      "updatedAt" = now()
  `,
    [input.conversationId, input.agencyId, input.channel, reason, input.triggerSequence, notBefore],
  )

  await trx('conversation_intelligence')
    .where({ conversationId: input.conversationId, status: 'fresh' })
    .update({ status: 'stale', updatedAt: trx.fn.now() })
}

export async function reclaimStaleAnalysisJobs(leaseMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs)

  await db.raw(
    `
    UPDATE conversation_analysis_jobs j
       SET status = 'failed', "lastError" = 'lease-expired-superseded',
           "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
     WHERE j.status = 'processing' AND j."lockedAt" < ?
       AND EXISTS (
         SELECT 1 FROM conversation_analysis_jobs p
          WHERE p."conversationId" = j."conversationId" AND p.status = 'pending'
       )
  `,
    [cutoff],
  )

  const res = await db.raw(
    `
    UPDATE conversation_analysis_jobs
       SET status = 'pending', "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'lease-expired-reclaimed', "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id
  `,
    [cutoff],
  )

  return res.rows?.length ?? 0
}

export async function claimAnalysisJobs(workerId: string, limit: number): Promise<ConversationAnalysisJob[]> {
  const res = await db.raw(
    `
    UPDATE conversation_analysis_jobs j
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE j.id IN (
       SELECT id FROM conversation_analysis_jobs
        WHERE status = 'pending' AND "notBefore" <= now()
        ORDER BY "notBefore" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING j.id, j."conversationId", j."agencyId", j.channel, j.reason,
               j."triggerSequence", j.status, j.attempts, j."maxAttempts"
  `,
    [workerId, limit],
  )

  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    channel: String(r.channel),
    reason: r.reason as AnalysisJobReason,
    triggerSequence: Number(r.triggerSequence),
    status: r.status as AnalysisJobStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
  }))
}

export async function completeAnalysisJob(jobId: number): Promise<void> {
  await db('conversation_analysis_jobs')
    .where({ id: jobId })
    .update({ status: 'done', lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
}

export type FailOutcome = { dead: boolean }

export async function failAnalysisJob(job: ConversationAnalysisJob, error: string): Promise<FailOutcome> {
  if (job.attempts >= job.maxAttempts) {
    await db('conversation_analysis_jobs')
      .where({ id: job.id })
      .update({ status: 'dead', lastError: error, lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
    return { dead: true }
  }

  const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, job.attempts - 1), BACKOFF_MAX_MS)
  const notBefore = new Date(Date.now() + backoffMs)

  const res = await db.raw(
    `
    UPDATE conversation_analysis_jobs
       SET status = 'pending', "notBefore" = ?, "lastError" = ?,
           "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = now()
     WHERE id = ?
       AND NOT EXISTS (
         SELECT 1 FROM conversation_analysis_jobs p
          WHERE p."conversationId" = ? AND p.status = 'pending'
       )
     RETURNING id
  `,
    [notBefore, error, job.id, job.conversationId],
  )

  if ((res.rows?.length ?? 0) === 0) {
    await db('conversation_analysis_jobs').where({ id: job.id }).update({
      status: 'failed',
      lastError: 'superseded-by-newer-pending',
      lockedAt: null,
      lockedBy: null,
      updatedAt: db.fn.now(),
    })
  }

  return { dead: false }
}

export type AnalysisMessage = { sequence: number; direction: string; text: string }

export async function getMaxMessageSequence(conversationId: number): Promise<number> {
  const row = await db('inbox_messages').where({ conversationId }).max<{ max: string | number | null }>('sequence as max').first()
  return row?.max != null ? Number(row.max) : 0
}

export type IntelligenceCoverage = {
  status: IntelligenceStatus
  coveredSequence: number
  inputHash: string | null
  analyzerVersion: string
  promptVersion: string | null
}

export async function getIntelligenceCoverage(conversationId: number, kind: string): Promise<IntelligenceCoverage | null> {
  const row = await db('conversation_intelligence')
    .where({ conversationId, kind })
    .first('status', 'coveredSequence', 'inputHash', 'analyzerVersion', 'promptVersion')
  if (!row) return null
  return {
    status: row.status as IntelligenceStatus,
    coveredSequence: Number(row.coveredSequence),
    inputHash: row.inputHash ?? null,
    analyzerVersion: String(row.analyzerVersion),
    promptVersion: row.promptVersion ?? null,
  }
}

/** Re-mark existing results fresh (input unchanged) without re-running AI. */
export async function refreshIntelligenceCoverage(
  conversationId: number,
  kinds: string[],
  coveredSequence: number,
): Promise<void> {
  await db('conversation_intelligence')
    .where({ conversationId })
    .whereIn('kind', kinds)
    .update({ status: 'fresh', coveredSequence, updatedAt: db.fn.now() })
}

export type AnalysisConversationContext = {
  leadId: number | null
  channel: string
  customerName: string | null
  leadName: string | null
  leadStatus: string | null
}

/** Conversation + lead context for the analyzer. Agency-scoped (worker has no session). */
export async function getAnalysisConversationContext(
  conversationId: number,
  agencyId: number,
): Promise<AnalysisConversationContext | null> {
  const row = await db('inbox_conversations as cv')
    .leftJoin('clients as c', 'c.id', 'cv.leadId')
    .where('cv.id', conversationId)
    .andWhere('cv.agencyId', agencyId)
    .first('cv.leadId', 'cv.channel', 'cv.customerName', 'c.name as leadName', 'c.status as leadStatus')
  if (!row) return null
  return {
    leadId: row.leadId != null ? Number(row.leadId) : null,
    channel: String(row.channel),
    customerName: row.customerName ?? null,
    leadName: row.leadName ?? null,
    leadStatus: row.leadStatus ?? null,
  }
}

/** Terminal job failure (config/permission states like disabled/forbidden) — no retry. */
export async function markAnalysisJobFailedTerminal(jobId: number, error: string): Promise<void> {
  await db('conversation_analysis_jobs')
    .where({ id: jobId })
    .update({ status: 'failed', lastError: error, lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
}

export async function listMessagesForAnalysis(conversationId: number, agencyId: number, limit = 30): Promise<AnalysisMessage[]> {
  const rows = await db('inbox_messages')
    .where({ conversationId, agencyId })
    .orderBy('sequence', 'desc')
    .limit(limit)
    .select('sequence', 'direction', 'text')

  return rows.map((r) => ({ sequence: Number(r.sequence), direction: String(r.direction), text: String(r.text ?? '') })).reverse()
}

export type UpsertIntelligenceInput = {
  conversationId: number
  agencyId: number
  channel: string
  kind: string
  data: unknown
  status: IntelligenceStatus
  schemaVersion: number
  analyzerVersion: string
  promptVersion?: string | null
  modelProvider?: string | null
  modelId?: string | null
  coveredSequence: number
  inputHash?: string | null
  confidence?: string | null
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  lastError?: string | null
}

export async function upsertConversationIntelligence(
  input: UpsertIntelligenceInput,
  executor: Knex | Knex.Transaction = db,
): Promise<void> {
  await executor('conversation_intelligence')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      channel: input.channel,
      kind: input.kind,
      data: JSON.stringify(input.data ?? {}),
      status: input.status,
      schemaVersion: input.schemaVersion,
      analyzerVersion: input.analyzerVersion,
      promptVersion: input.promptVersion ?? null,
      modelProvider: input.modelProvider ?? null,
      modelId: input.modelId ?? null,
      coveredSequence: input.coveredSequence,
      inputHash: input.inputHash ?? null,
      confidence: input.confidence ?? null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      costUsd: input.costUsd ?? 0,
      lastError: input.lastError ?? null,
      updatedAt: db.fn.now(),
    })
    .onConflict(['conversationId', 'kind'])
    .merge({
      data: JSON.stringify(input.data ?? {}),
      status: input.status,
      schemaVersion: input.schemaVersion,
      analyzerVersion: input.analyzerVersion,
      promptVersion: input.promptVersion ?? null,
      modelProvider: input.modelProvider ?? null,
      modelId: input.modelId ?? null,
      coveredSequence: input.coveredSequence,
      inputHash: input.inputHash ?? null,
      confidence: input.confidence ?? null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      costUsd: input.costUsd ?? 0,
      lastError: input.lastError ?? null,
      updatedAt: db.fn.now(),
    })
}

/**
 * Atomically persist all kinds produced by one composite analysis run. All-or-
 * nothing matters: a partial write (e.g. summary without intent) combined with
 * the coverage skip would leave the missing kinds stale forever.
 */
export async function upsertManyConversationIntelligence(inputs: UpsertIntelligenceInput[]): Promise<void> {
  await db.transaction(async (trx) => {
    for (const input of inputs) await upsertConversationIntelligence(input, trx)
  })
}

/** Mark kinds failed (e.g. on dead-letter) so the Inbox can surface it. */
export async function markIntelligenceFailed(
  conversationId: number,
  agencyId: number,
  channel: string,
  kinds: string[],
  analyzerVersion: string,
  schemaVersion: number,
  error: string,
): Promise<void> {
  await db.transaction(async (trx) => {
    for (const kind of kinds) {
      await trx('conversation_intelligence')
        .insert({
          conversationId,
          agencyId,
          channel,
          kind,
          data: JSON.stringify({}),
          status: 'failed',
          schemaVersion,
          analyzerVersion,
          lastError: error,
          updatedAt: trx.fn.now(),
        })
        .onConflict(['conversationId', 'kind'])
        .merge({ status: 'failed', lastError: error, updatedAt: trx.fn.now() })
    }
  })
}

export type IntelligenceRunInput = {
  conversationId: number
  agencyId: number
  jobId: number | null
  kind: string
  success: boolean
  analyzerVersion: string
  schemaVersion: number
  modelProvider?: string | null
  modelId?: string | null
  coveredSequence: number
  inputHash?: string | null
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  latencyMs?: number | null
  errorReason?: string | null
  data?: unknown
}

export async function insertIntelligenceRun(input: IntelligenceRunInput): Promise<void> {
  await db('conversation_intelligence_runs').insert({
    conversationId: input.conversationId,
    agencyId: input.agencyId,
    jobId: input.jobId,
    kind: input.kind,
    success: input.success,
    analyzerVersion: input.analyzerVersion,
    schemaVersion: input.schemaVersion,
    modelProvider: input.modelProvider ?? null,
    modelId: input.modelId ?? null,
    coveredSequence: input.coveredSequence,
    inputHash: input.inputHash ?? null,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    costUsd: input.costUsd ?? 0,
    latencyMs: input.latencyMs ?? null,
    errorReason: input.errorReason ?? null,
    data: input.data != null ? JSON.stringify(input.data) : null,
  })
}

// ─────────────────────────── Read model (UI) ─────────────────────────────

export type ConversationIntelligenceItem = {
  kind: string
  data: unknown
  status: IntelligenceStatus
  coveredSequence: number
  analyzerVersion: string
  modelId: string | null
  confidence: string | null
  updatedAt: string | null
  lastError: string | null
}

export type ConversationIntelligenceView = {
  items: ConversationIntelligenceItem[]
  jobPending: boolean
  jobStatus: AnalysisJobStatus | null
}

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

export async function getConversationIntelligence(
  agencyId: number,
  conversationId: number,
): Promise<ConversationIntelligenceView> {
  const [rows, job] = await Promise.all([
    db('conversation_intelligence')
      .where({ agencyId, conversationId })
      .select('kind', 'data', 'status', 'coveredSequence', 'analyzerVersion', 'modelId', 'confidence', 'updatedAt', 'lastError'),
    db('conversation_analysis_jobs')
      .where({ agencyId, conversationId })
      .whereIn('status', ['pending', 'processing'])
      .first('status'),
  ])

  const items: ConversationIntelligenceItem[] = rows.map((r) => ({
    kind: String(r.kind),
    data: typeof r.data === 'string' ? safeJson(r.data) : r.data,
    status: r.status as IntelligenceStatus,
    coveredSequence: Number(r.coveredSequence),
    analyzerVersion: String(r.analyzerVersion),
    modelId: r.modelId ?? null,
    confidence: r.confidence ?? null,
    updatedAt: toIso(r.updatedAt),
    lastError: r.lastError ?? null,
  }))

  return {
    items,
    jobPending: !!job,
    jobStatus: (job?.status as AnalysisJobStatus | undefined) ?? null,
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
