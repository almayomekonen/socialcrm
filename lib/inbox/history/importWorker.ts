import { parseHistoryValue } from '@/lib/whatsapp/parseHistory'
import { historyAllowlist, historyActivationState } from '@/lib/whatsapp/historyFlags'
import { persistHistoryMessage, resolveHistoryTenant } from '@/lib/inbox/persistHistoryMessage'
import {
  checkpointHistoryImport,
  progressHistoryImport,
  claimHistoryImports,
  failHistoryImport,
  reclaimStaleHistoryImports,
  settleHistoryImport,
  type HistoryImportRow,
} from '@/db/whatsappHistoryImports'

/**
 * Drain `whatsapp_history_imports` — one durable delivery at a time.
 *
 * THE RECOVERY MODEL IS THE DESIGN. There is no chunk-wide transaction. Each
 * message is persisted atomically by `persistHistoryMessage`, so a worker that
 * dies after message 400 of 900 leaves 400 committed rows and a lease that
 * expires. On reclaim those 400 come back as `duplicate` via the existing
 * `(channel, externalId)` constraint, 401 is retried, and the rest continue.
 * No data loss, no duplicate rows. Wrapping the chunk in one transaction would
 * turn a mid-chunk crash into a total rollback of an archive that cannot be
 * re-requested.
 *
 * ONE MALFORMED MESSAGE NEVER KILLS A CHUNK. Every per-message outcome is
 * counted; only an infrastructure failure fails the delivery.
 *
 * NOTHING HERE ACTS ON THE BUSINESS. It parses, persists, and counts. No lead,
 * no conversation, no signal, no automation, no model call, no media fetch — a
 * test asserts none of it is even imported.
 *
 * THE PAYLOAD IS RE-PARSED FROM THE STORED RAW VALUE, not carried in memory from
 * the webhook. That is what makes the raw-first record worth having: a parser
 * fix can be deployed and the delivery reprocessed from what Meta actually sent.
 */

export type ProcessResult = {
  id: number
  /** `checkpointed` = progress saved, delivery released, more work remains. */
  status: 'completed' | 'partial' | 'deferred' | 'error' | 'failed' | 'checkpointed'
  messagesSeen: number
  messagesInserted: number
  messagesDuplicate: number
  messagesSkipped: number
}

export type WorkerSummary = {
  claimed: number
  completed: number
  partial: number
  deferred: number
  errored: number
  failed: number
  /** Deliveries that saved progress and yielded with work remaining. */
  checkpointed: number
  /** Deliveries recovered from a lease whose worker died. */
  reclaimed: number
  /** Claimed deliveries on their second or later attempt. */
  retried: number
  /** True when the time budget stopped the run before `limit` was reached. */
  budgetExhausted: boolean
  durationMs: number
}

export type RunHistoryWorkerOptions = {
  /** Hard ceiling on deliveries per invocation. Bounded by design. */
  limit?: number
  /** Deliveries claimed per round-trip. */
  batchSize?: number
  /** Wall-clock budget. Must finish well inside the route's maxDuration. */
  budgetMs?: number
  /** How long a lease may be held before another worker may reclaim it. */
  leaseMs?: number
  now?: () => number
}

/**
 * 20s of a 60s route budget. The margin is not caution for its own sake: a
 * delivery already claimed when the budget expires still has to finish and
 * settle, and the response has to be written before the platform intervenes.
 */
const DEFAULT_BUDGET_MS = 20_000
const DEFAULT_LIMIT = 25
const DEFAULT_BATCH_SIZE = 5
/** Matches `signalWorker`. Long enough for a slow chunk, short enough to recover. */
const DEFAULT_LEASE_MS = 5 * 60 * 1000
/**
 * Messages one delivery may import in a single run before yielding. Sized so a
 * pathological chunk cannot monopolise the run: at ~7 DB round-trips per message
 * this stays comfortably inside the worker budget on a remote database.
 */
const DEFAULT_MESSAGE_BUDGET = 250
/**
 * How often progress is written down. Every message would double the round-trips
 * for no real gain — a crash re-doing 50 deduplicated messages is cheap, and the
 * cursor is still never ahead of what is committed.
 */
const CHECKPOINT_EVERY = 50

/**
 * Flush progress mid-run WITHOUT releasing the lease.
 *
 * The distinction from `checkpointHistoryImport` matters: this one keeps the
 * delivery `processing` and keeps this worker's claim on it, so the run
 * continues. It exists purely to narrow the crash window — if the process dies
 * two messages later, the reclaim resumes from here instead of from the start.
 * Counts are accumulated by the same statement and reset by the caller.
 */
async function recordProgress(
  id: number,
  cursor: number,
  counts: { messagesSeen: number; messagesInserted: number; messagesDuplicate: number; messagesSkipped: number },
): Promise<void> {
  await progressHistoryImport(id, cursor, { ...counts })
  counts.messagesSeen = 0
  counts.messagesInserted = 0
  counts.messagesDuplicate = 0
  counts.messagesSkipped = 0
}

/**
 * Process one claimed delivery.
 *
 * Exported for the worker and for tests; it assumes the row is already leased.
 */
export async function processHistoryImport(
  job: HistoryImportRow,
  bounds: { deadline?: number; messageBudget?: number; now?: () => number } = {},
): Promise<ProcessResult> {
  const now = bounds.now ?? (() => Date.now())
  const deadline = bounds.deadline
  const messageBudget = bounds.messageBudget ?? DEFAULT_MESSAGE_BUDGET
  const base = { id: job.id, messagesSeen: 0, messagesInserted: 0, messagesDuplicate: 0, messagesSkipped: 0 }

  /**
   * RE-VERIFY THE TENANT AT PROCESSING TIME (Wave 2A.2g.1).
   *
   * `agencyId` was resolved from `phoneNumberId` when the delivery was received,
   * but F-3 means a message can now CREATE a conversation, so a stale or
   * mismatched pairing would create it under the wrong agency instead of failing
   * closed the way the find-only lookup used to. One query per delivery — not
   * per message — closes that, and also catches a connection that changed hands
   * between receipt and import.
   *
   * It is a terminal `error`, not a retry: the pairing will not fix itself, and
   * the raw payload stays on the row for a human to re-target if the connection
   * legitimately moved.
   */
  const owner = await resolveHistoryTenant(job.phoneNumberId)
  if (owner !== job.agencyId) {
    await settleHistoryImport(job.id, 'error', {}, 'tenant_mismatch')
    console.error('[WhatsappHistory] history_sync_error', { importId: job.id, reason: 'tenant_mismatch' })
    return { ...base, status: 'error' }
  }

  const event = parseHistoryValue(job.payload)
  if (!event) {
    // The stored payload no longer parses. A retry cannot fix that, so it is
    // terminal for now — and the raw value is still on the row, so a future
    // parser fix can revive it deliberately.
    await settleHistoryImport(job.id, 'error', {}, 'unparseable_delivery')
    console.log('[WhatsappHistory] history_sync_error', { importId: job.id, reason: 'unparseable_delivery' })
    return { ...base, status: 'error' }
  }

  if (event.kind === 'history_error') {
    // Meta reported a failure instead of an archive. NEVER 'completed': the
    // business declining to share history is not a successful import of nothing.
    const code = event.errors[0]?.code ?? null
    const note = code === 2593109 ? 'history_sync_disabled_by_business' : `meta_error:${code ?? 'unknown'}`
    await settleHistoryImport(job.id, 'error', {}, note)
    console.log('[WhatsappHistory] history_sync_error', { importId: job.id, agencyId: job.agencyId, code, note })
    return { ...base, status: 'error' }
  }

  if (event.kind === 'history_media_followup') {
    // DURABLE BUT DEFERRED. Wave 2A.2c deliberately does not persist media
    // follow-ups, and Meta documents no correlation guarantee beyond the shared
    // wamid — so inventing one here would be inventing a contract. The raw
    // payload stays on the row as the source Wave 2A.2e will work from.
    await settleHistoryImport(job.id, 'deferred', { messagesSeen: event.messages.length }, 'media_followup_deferred')
    console.log('[WhatsappHistory] history_media_deferred', {
      importId: job.id,
      agencyId: job.agencyId,
      messages: event.messages.length,
    })
    return { ...base, status: 'deferred', messagesSeen: event.messages.length }
  }

  const counts = { messagesSeen: 0, messagesInserted: 0, messagesDuplicate: 0, messagesSkipped: 0 }

  const ctx = {
    agencyId: job.agencyId,
    phoneNumberId: job.phoneNumberId,
    phase: event.phase,
    chunkOrder: event.chunkOrder,
    progress: event.progress,
  }

  /**
   * The delivery's messages in PAYLOAD ORDER — threads in order, messages in
   * order. `job.cursor` is an offset into exactly this list, which is what makes
   * a saved cursor meaningful in a different process: the list is rebuilt from
   * the stored raw payload, so it is identical every time.
   */
  const flattened = event.threads.flatMap((t) => t.messages)

  // Parser-level rejections (no wamid, unusable timestamp, unidentifiable
  // thread) are already skipped facts, not failures. Counted ONCE, on the run
  // that starts the delivery, so a resumed run does not re-count them.
  if (job.cursor === 0) {
    counts.messagesSkipped += event.skipped.length
    counts.messagesSeen += event.skipped.length
  }

  let cursor = job.cursor
  let sinceCheckpoint = 0

  while (cursor < flattened.length) {
    // THE PER-DELIVERY BOUND (F-1). Checked inside the message loop, not just
    // between deliveries: one chunk of undocumented size must not be able to
    // consume the whole run, overrun the route's maxDuration, and be killed
    // mid-flight. Hitting either bound is a checkpoint, never a failure.
    if (deadline !== undefined && now() >= deadline) break
    if (messageBudget !== undefined && cursor - job.cursor >= messageBudget) break

    const message = flattened[cursor]
    counts.messagesSeen += 1

    // A permanently malformed message must not block the ones behind it, so
    // every per-message outcome — including a thrown error — advances the
    // cursor. The message is counted as skipped and the delivery moves on.
    try {
      const result = await persistHistoryMessage(message, ctx)
      if (result.outcome === 'inserted') counts.messagesInserted += 1
      else if (result.outcome === 'duplicate') counts.messagesDuplicate += 1
      // `no_conversation` and `skipped` are POLICY RESULTS, not transient
      // failures. Retrying either produces the identical answer forever.
      else counts.messagesSkipped += 1
    } catch (err) {
      counts.messagesSkipped += 1
      console.error('[WhatsappHistory] history_message_skipped', {
        importId: job.id,
        agencyId: job.agencyId,
        index: cursor,
        reason: String((err as Error)?.message ?? 'unknown').slice(0, 120),
      })
    }

    // ADVANCED ONLY AFTER the message's own transaction committed. A crash here
    // re-does at most CHECKPOINT_EVERY messages, which message-level dedup
    // absorbs — it can never skip one.
    cursor += 1
    sinceCheckpoint += 1

    // A mid-run checkpoint narrows the crash window without ending the run: the
    // lease is released and re-acquired implicitly by the same `processing`
    // status guard, so the delivery keeps its slot and simply becomes safe to
    // resume. Counts are flushed with it, then reset — they have been recorded.
    if (sinceCheckpoint >= CHECKPOINT_EVERY && cursor < flattened.length) {
      await recordProgress(job.id, cursor, counts)
      sinceCheckpoint = 0
    }
  }

  if (cursor < flattened.length) {
    // Bound reached with work outstanding: save progress, release the lease, and
    // let the next claim continue from here. Not complete, and never reported as
    // complete.
    await checkpointHistoryImport(job.id, cursor, counts)
    console.log('[WhatsappHistory] history_chunk_checkpoint', {
      importId: job.id,
      agencyId: job.agencyId,
      cursor,
      total: flattened.length,
    })
    return { id: job.id, status: 'checkpointed', ...counts }
  }

  const status = counts.messagesSkipped > 0 ? 'partial' : 'completed'
  await settleHistoryImport(job.id, status, counts, null, cursor)
  console.log(`[WhatsappHistory] history_chunk_${status}`, {
    importId: job.id,
    agencyId: job.agencyId,
    phase: event.phase,
    chunkOrder: event.chunkOrder,
    progress: event.progress,
    ...counts,
  })
  return { id: job.id, status, ...counts }
}

/**
 * Claim and drain up to `limit` deliveries.
 *
 * An infrastructure error — a dropped connection, a lock timeout — goes through
 * `failHistoryImport`, which backs off and eventually dead-letters. That is the
 * ONLY retryable class. A missing conversation, an invalid wamid, an invalid
 * timestamp and an unresolvable tenant are all answers, not outages, and are
 * never retried.
 */
export async function runHistoryImportWorker(
  workerId: string,
  opts: RunHistoryWorkerOptions = {},
): Promise<WorkerSummary> {
  const now = opts.now ?? (() => Date.now())
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT)
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE)
  const startedAt = now()
  const deadline = startedAt + (opts.budgetMs ?? DEFAULT_BUDGET_MS)

  const summary: WorkerSummary = {
    claimed: 0,
    completed: 0,
    partial: 0,
    deferred: 0,
    errored: 0,
    failed: 0,
    checkpointed: 0,
    reclaimed: 0,
    retried: 0,
    budgetExhausted: false,
    durationMs: 0,
  }

  // Deny-by-default, evaluated ONCE before any I/O. An empty allowlist means
  // this whole invocation touches nothing — not even a claim query.
  const allowPhoneNumberIds = historyAllowlist()
  if (allowPhoneNumberIds !== 'all' && allowPhoneNumberIds.length === 0) {
    summary.durationMs = now() - startedAt
    return summary
  }

  // Recover deliveries whose worker died holding the lease, BEFORE claiming, so
  // a crashed run's work is picked up by the next one rather than waiting for a
  // new webhook that will never come.
  summary.reclaimed = await reclaimStaleHistoryImports(opts.leaseMs ?? DEFAULT_LEASE_MS, now())

  // BOUNDED on both axes: never more than `limit` deliveries, never past the
  // deadline. There is no unbounded loop and no way for one HTTP request to
  // process an entire archive — the next invocation continues where this
  // stopped, because durability lives in Postgres and not in this handler.
  while (summary.claimed < limit) {
    if (now() >= deadline) {
      summary.budgetExhausted = true
      break
    }

    const jobs = await claimHistoryImports(workerId, Math.min(batchSize, limit - summary.claimed), {
      allowPhoneNumberIds,
    })
    if (jobs.length === 0) break

    summary.claimed += jobs.length
    summary.retried += jobs.filter((j) => j.attempts > 1).length

    for (const job of jobs) {
      try {
        const result = await processHistoryImport(job, { deadline, now })
        if (result.status === 'completed') summary.completed += 1
        else if (result.status === 'partial') summary.partial += 1
        else if (result.status === 'deferred') summary.deferred += 1
        else if (result.status === 'checkpointed') summary.checkpointed += 1
        else summary.errored += 1
      } catch (err) {
        summary.failed += 1
        // A classification, never a payload excerpt: this line must never carry a
        // message body, a phone number or a customer identifier.
        await failHistoryImport(job.id, String((err as Error)?.message ?? 'unknown').slice(0, 200))
        console.error('[WhatsappHistory] history_chunk_failed', { importId: job.id, agencyId: job.agencyId })
      }
    }
  }

  summary.durationMs = now() - startedAt
  if (summary.claimed > 0 || summary.reclaimed > 0) {
    console.log('[WhatsappHistory] history_worker_tick', {
      claimed: summary.claimed,
      completed: summary.completed,
      partial: summary.partial,
      deferred: summary.deferred,
      errored: summary.errored,
      failed: summary.failed,
      checkpointed: summary.checkpointed,
      reclaimed: summary.reclaimed,
      retried: summary.retried,
      budgetExhausted: summary.budgetExhausted,
      durationMs: summary.durationMs,
      ...historyActivationState(),
    })
  }
  return summary
}
