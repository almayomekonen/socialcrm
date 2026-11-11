import 'server-only'
import { db } from '@/config/db'
import type { DocumentPollOutcome, DocumentSubmitOutcome, IntegrationEnvironment } from '@/lib/integrations/core/types'
import type { ConfirmedPayment } from '@/lib/integrations/providers/smartbee/payload'
import type { SmartbeeDocType, SmartbeeDocumentBody, SmartbeeVatOption } from '@/lib/integrations/providers/smartbee/types'

/**
 * smartbee_documents — one row per approved request, written BEFORE SmartBee is
 * called, then moved forward only by what SmartBee answers. Every query names
 * the agency, except the sweep's claim, which hands each row on with its own
 * `agencyId` and is re-checked against the allowlist by the caller.
 *
 *   pending  → SmartBee has not confirmed it holds the request (never sent, or
 *              the answer was lost). Re-sent with the SAME providerMsgId.
 *   queued   → SmartBee holds it (`apiMessageId`); polled.
 *   created  → 102: number, allocation number and PDF links stored.
 *   draft / failed / stalled → terminal; nothing is re-sent.
 */

const T = 'smartbee_documents'

export type SmartbeeDocumentStatus = 'pending' | 'queued' | 'created' | 'draft' | 'failed' | 'stalled'

export type SmartbeeDocumentRow = {
  id: number
  agencyId: number
  connectionId: number
  leadId: number | null
  agentActionId: string
  environment: IntegrationEnvironment
  providerMsgId: string
  apiMessageId: string | null
  docType: SmartbeeDocType
  description: string
  totalAmount: number
  vatOption: SmartbeeVatOption | null
  payment: ConfirmedPayment | null
  requestSnapshot: SmartbeeDocumentBody
  approvedByUserId: number
  status: SmartbeeDocumentStatus
  resultCode: number | null
  failureReason: string | null
  documentId: string | null
  docIndex: string | null
  taxConfirmationNumber: string | null
  linkToOriginal: string | null
  linkToCopy: string | null
  submitAttempts: number
  pollAttempts: number
  nextAttemptAt: Date
  createdAt: Date
  noticeState: string | null
  resolution: 'exists' | 'absent' | null
  resolvedByUserId: number | null
  resolvedAt: Date | null
  resolvedDocIndex: string | null
  resolutionActionId: string | null
}

function toRow(r: Record<string, unknown> | undefined): SmartbeeDocumentRow | null {
  if (!r) return null
  return {
    ...(r as SmartbeeDocumentRow),
    id: Number(r.id),
    connectionId: Number(r.connectionId),
    agencyId: Number(r.agencyId),
    leadId: r.leadId == null ? null : Number(r.leadId),
    totalAmount: Number(r.totalAmount),
    approvedByUserId: Number(r.approvedByUserId),
  }
}

export type NewSmartbeeDocument = {
  agencyId: number
  connectionId: number
  leadId: number
  agentActionId: string
  environment: IntegrationEnvironment
  providerMsgId: string
  docType: SmartbeeDocType
  description: string
  totalAmount: number
  vatOption: SmartbeeVatOption | null
  payment: ConfirmedPayment | null
  requestSnapshot: SmartbeeDocumentBody
  approvedByUserId: number
  approvedAt: Date
}

/** Insert once per agent action; a second call (retry, crash, double tap) returns the existing row unchanged. */
export async function ensureSmartbeeDocument(input: NewSmartbeeDocument): Promise<{ row: SmartbeeDocumentRow; inserted: boolean }> {
  const inserted = await db(T)
    .insert({ ...input, payment: input.payment ? JSON.stringify(input.payment) : null, requestSnapshot: JSON.stringify(input.requestSnapshot) })
    .onConflict('agentActionId')
    .ignore()
    .returning('id')
  const row = await findSmartbeeDocumentByAction(input.agencyId, input.agentActionId)
  if (!row) throw new Error('smartbee_documents: row missing after insert')
  return { row, inserted: inserted.length === 1 }
}

export async function findSmartbeeDocumentByAction(agencyId: number, agentActionId: string): Promise<SmartbeeDocumentRow | null> {
  return toRow(await db(T).where({ agencyId, agentActionId }).first())
}

export async function findSmartbeeDocument(agencyId: number, id: number): Promise<SmartbeeDocumentRow | null> {
  return toRow(await db(T).where({ agencyId, id }).first())
}

/**
 * A request for this lead whose outcome is not settled yet: pending (maybe not
 * yet at SmartBee), queued (SmartBee holds it), or stalled with no owner
 * resolution (SmartBee never confirmed either way). While one exists no second
 * document is proposed or recorded for the lead, so an uncertain request can
 * never be "fixed" by asking again. Returns its status, or null.
 */
export async function unsettledSmartbeeDocument(agencyId: number, leadId: number, exceptActionId?: string): Promise<'pending' | 'queued' | 'stalled' | null> {
  const q = db(T)
    .where({ agencyId, leadId })
    .where((w) => w.whereIn('status', ['pending', 'queued']).orWhere((s) => s.where('status', 'stalled').whereNull('resolution')))
  if (exceptActionId) q.whereNot({ agentActionId: exceptActionId })
  const row = (await q.orderBy('id', 'desc').first('status')) as { status: 'pending' | 'queued' | 'stalled' } | undefined
  return row?.status ?? null
}

const SUBMIT_BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
const backoff = (attempt: number) => SUBMIT_BACKOFF_MS[Math.min(attempt, SUBMIT_BACKOFF_MS.length - 1)]

/** What SmartBee said to a create. Only moves a row that is still `pending`. */
export async function recordSubmitOutcome(agencyId: number, id: number, outcome: DocumentSubmitOutcome, nowMs: number): Promise<void> {
  const q = db(T).where({ agencyId, id, status: 'pending' })
  // `submitAttempts` is counted BEFORE the send (markSmartbeeSubmitStarted), not here.
  const common = { lastAttemptAt: new Date(nowMs), updatedAt: db.fn.now() }
  if (outcome.kind === 'accepted') {
    await q.update({ ...common, status: 'queued', apiMessageId: outcome.providerRef, resultCode: outcome.duplicate ? 95 : 101, nextAttemptAt: new Date(nowMs + 2_000) })
  } else if (outcome.kind === 'rejected') {
    await q.update({ ...common, status: 'failed', resultCode: outcome.code, failureReason: outcome.reason, validationErrors: outcome.details ? JSON.stringify(outcome.details) : null, completedAt: new Date(nowMs) })
  } else {
    const row = (await db(T).where({ agencyId, id }).first('submitAttempts')) as { submitAttempts: number } | undefined
    await q.update({ ...common, resultCode: outcome.code, failureReason: outcome.reason, nextAttemptAt: new Date(nowMs + backoff(Math.max(0, (row?.submitAttempts ?? 1) - 1))) })
  }
}

/**
 * Counted BEFORE each send to SmartBee. From here on the request MAY exist at
 * SmartBee, whatever happens to this process: `submitAttempts > 0` is that fact.
 */
export async function markSmartbeeSubmitStarted(agencyId: number, id: number, nowMs: number): Promise<void> {
  await db(T).where({ agencyId, id, status: 'pending' }).update({ submitAttempts: db.raw('"submitAttempts" + 1'), lastAttemptAt: new Date(nowMs), updatedAt: db.fn.now() })
}

/** A possibly-sent request that cannot be retried right now: kept pending, same providerMsgId, tried again later. */
export async function deferSmartbeeSubmit(agencyId: number, id: number, reason: string, nowMs: number): Promise<void> {
  await db(T).where({ agencyId, id, status: 'pending' }).update({ failureReason: reason, nextAttemptAt: new Date(nowMs + DEFER_MS), updatedAt: db.fn.now() })
}

const DEFER_MS = 5 * 60_000

/** What SmartBee said to a poll. Only moves a row that is `queued`. */
export async function recordPollOutcome(agencyId: number, id: number, outcome: DocumentPollOutcome, nowMs: number, nextPollMs: number): Promise<void> {
  const q = db(T).where({ agencyId, id, status: 'queued' })
  const common = { pollAttempts: db.raw('"pollAttempts" + 1'), lastAttemptAt: new Date(nowMs), updatedAt: db.fn.now() }
  if (outcome.kind === 'created') {
    const d = outcome.document
    await q.update({
      ...common,
      status: 'created',
      resultCode: 102,
      failureReason: null,
      documentId: d.providerDocumentId,
      docIndex: d.number,
      taxConfirmationNumber: d.allocationNumber,
      linkToOriginal: d.originalUrl,
      linkToCopy: d.copyUrl,
      completedAt: new Date(nowMs),
    })
  } else if (outcome.kind === 'draft') {
    await q.update({ ...common, status: 'draft', resultCode: 103, documentId: outcome.draftId, completedAt: new Date(nowMs) })
  } else if (outcome.kind === 'failed') {
    await q.update({ ...common, status: 'failed', resultCode: outcome.code, failureReason: outcome.reason, validationErrors: outcome.details ? JSON.stringify(outcome.details) : null, completedAt: new Date(nowMs) })
  } else {
    await q.update({ ...common, resultCode: outcome.kind === 'retry' ? outcome.code : 1, nextAttemptAt: new Date(nowMs + nextPollMs) })
  }
}

/** Gave up waiting: SmartBee never confirmed. Terminal and honest; nothing is re-sent. */
export async function markSmartbeeDocumentStalled(agencyId: number, id: number, nowMs: number): Promise<void> {
  await db(T).whereIn('status', ['pending', 'queued']).where({ agencyId, id }).update({ status: 'stalled', completedAt: new Date(nowMs), updatedAt: db.fn.now() })
}

/**
 * The sweep's claim: rows due now, each leased for `leaseMs` by pushing
 * `nextAttemptAt` forward in the same statement, so two crons never work one row.
 */
export async function claimDueSmartbeeDocuments(nowMs: number, agencyIds: readonly number[], limit: number, leaseMs: number): Promise<SmartbeeDocumentRow[]> {
  if (!agencyIds.length) return []
  const r = await db.raw(
    `UPDATE ${T} SET "nextAttemptAt" = :lease, "updatedAt" = now()
     WHERE id IN (
       SELECT id FROM ${T}
       WHERE status IN ('pending','queued') AND "nextAttemptAt" <= :now AND "agencyId" = ANY(:agencies)
       ORDER BY "nextAttemptAt" ASC LIMIT :limit FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
    { now: new Date(nowMs), lease: new Date(nowMs + leaseMs), agencies: [...agencyIds], limit },
  )
  return (r.rows as Record<string, unknown>[]).map((x) => toRow(x)!)
}

/** Claims the single owner notice for a terminal row. False = someone already claimed it. */
export async function claimSmartbeeNotice(agencyId: number, id: number): Promise<boolean> {
  const n = await db(T)
    .where({ agencyId, id })
    .whereNull('noticeState')
    .whereIn('status', ['created', 'draft', 'failed', 'stalled'])
    .update({ noticeState: 'sending', updatedAt: db.fn.now() })
  return n === 1
}

export async function recordSmartbeeNotice(agencyId: number, id: number, state: 'sent' | 'unknown' | 'rejected' | 'not_eligible'): Promise<void> {
  await db(T).where({ agencyId, id }).update({ noticeState: state, updatedAt: db.fn.now() })
}

/** Terminal rows whose owner has not been told yet (the sweep's second job). */
export async function unnotifiedTerminalDocuments(agencyIds: readonly number[], sinceMs: number, limit: number): Promise<SmartbeeDocumentRow[]> {
  if (!agencyIds.length) return []
  const rows = (await db(T)
    .whereIn('agencyId', [...agencyIds])
    .whereIn('status', ['created', 'draft', 'failed', 'stalled'])
    .whereNull('noticeState')
    .where('completedAt', '>', new Date(sinceMs))
    .orderBy('id', 'asc')
    .limit(limit)) as Record<string, unknown>[]
  return rows.map((r) => toRow(r)!)
}

/** The follow-up's claim on ONE row it is waiting on: due now and still moving. Same lease as the sweep. */
export async function claimSmartbeeDocument(agencyId: number, id: number, nowMs: number, leaseMs: number): Promise<SmartbeeDocumentRow | null> {
  const r = await db.raw(
    `UPDATE ${T} SET "nextAttemptAt" = :lease, "updatedAt" = now()
     WHERE id = :id AND "agencyId" = :agencyId AND status IN ('pending','queued') AND "nextAttemptAt" <= :now
     RETURNING *`,
    { id, agencyId, now: new Date(nowMs), lease: new Date(nowMs + leaseMs) },
  )
  return toRow((r.rows as Record<string, unknown>[])[0])
}
