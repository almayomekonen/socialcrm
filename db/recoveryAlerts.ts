/**
 * Recovery Alerts — persistence for the "lead waited too long" event and its
 * resolution. See migration 20260623000001_create_recovery_alerts for the
 * sensor-vs-event-record rationale.
 *
 * Every alert field is DERIVED from inbox_conversations/clients at create time.
 * This module never invents a waiting fact (care-charter Law 1): if a lead is
 * not actually waiting, no alert is created.
 *
 * Read-only sensor logic lives in services/automation/recoveryEngine.ts. This
 * module owns the writes (create/resolve) and the page read.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { isAdmin, type Roles } from '@/types/roles'

const TERMINAL_STATUSES = ['closed', 'lost']

export interface RecoveryAlertView {
  id: string
  leadId: string
  leadName: string
  conversationId: string | null
  status: 'open' | 'resolved'
  waitingMinutes: number
  lastCustomerMessage: string
  lastCustomerMessageAt: string | null // ISO 8601
  createdAt: string // ISO 8601
  resolvedAt: string | null
}

export type CreateAlertResult =
  | { created: true; alertId: number }
  | { created: false; reason: 'not_waiting' | 'duplicate' }

interface WaitingSnapshotRow {
  conversationId: number
  agencyId: number
  lastMessageText: string | null
  lastInboundAt: string | Date
}

interface AlertJoinRow {
  id: number
  leadId: number
  conversationId: number | null
  status: 'open' | 'resolved'
  waitingMinutes: number
  lastCustomerMessage: string | null
  lastCustomerMessageAt: string | Date | null
  createdAt: string | Date
  resolvedAt: string | Date | null
  firstName: string | null
  lastName: string | null
}

/** clients has no `name`/`customerName` column — name is firstName + lastName. */
export function nameFrom(firstName: string | null, lastName: string | null): string {
  const full = [firstName, lastName].filter(Boolean).join(' ').trim()
  return full || 'ליד'
}

/**
 * Re-derives the lead's current waiting state from inbox_conversations and, if
 * the lead really is waiting (open thread, last message inbound, lead not in a
 * terminal status), inserts an alert. The partial unique index makes the insert
 * idempotent: a second call while an open alert exists is swallowed as
 * `duplicate`.
 */
export async function createRecoveryAlertForLead(leadId: number): Promise<CreateAlertResult> {
  const snapshot = (await db('inbox_conversations as cv')
    .join('clients as c', 'c.id', 'cv.leadId')
    .where('cv.leadId', leadId)
    .where('cv.state', 'open')
    .where('cv.lastDirection', 'inbound')
    .whereNotNull('cv.lastInboundAt')
    .where((b) => b.whereNull('c.status').orWhereNotIn('c.status', TERMINAL_STATUSES))
    .orderBy('cv.lastInboundAt', 'asc')
    .select(
      'cv.id as conversationId',
      'cv.agencyId as agencyId',
      'cv.lastMessageText as lastMessageText',
      'cv.lastInboundAt as lastInboundAt',
    )
    .first()) as WaitingSnapshotRow | undefined

  if (!snapshot) return { created: false, reason: 'not_waiting' }

  const at = new Date(snapshot.lastInboundAt)
  const waitingMinutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000))

  const [row] = await db('recovery_alerts')
    .insert({
      agencyId: snapshot.agencyId,
      leadId,
      conversationId: snapshot.conversationId,
      status: 'open',
      waitingMinutes,
      lastCustomerMessage: snapshot.lastMessageText ?? null,
      lastCustomerMessageAt: at,
    })
    .onConflict() // partial unique index on (leadId) WHERE status='open'
    .ignore()
    .returning('id')

  if (!row) return { created: false, reason: 'duplicate' }
  return { created: true, alertId: Number(row.id) }
}

/**
 * Page read. Scopes to the agency; for non-admins, restricts to alerts whose
 * lead the user owns (clients.userId ∈ gotPermIds) — same ownership model as
 * the leads table. Open alerts first, then newest.
 */
export async function getRecoveryAlerts(
  agencyId: number,
  role: Roles,
  gotPermIds: number[],
  opts: { status?: 'open' | 'resolved' | 'all'; limit?: number } = {},
): Promise<RecoveryAlertView[]> {
  const status = opts.status ?? 'open'
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)

  const rows = (await db('recovery_alerts as a')
    .join('clients as c', 'c.id', 'a.leadId')
    .where('a.agencyId', agencyId)
    .modify((b) => {
      if (status !== 'all') b.where('a.status', status)
      if (!isAdmin(role)) b.whereIn('c.userId', gotPermIds)
    })
    .orderByRaw(`(a.status = 'open') DESC, a."createdAt" DESC`)
    .limit(limit)
    .select(
      'a.id as id',
      'a.leadId as leadId',
      'a.conversationId as conversationId',
      'a.status as status',
      'a.waitingMinutes as waitingMinutes',
      'a.lastCustomerMessage as lastCustomerMessage',
      'a.lastCustomerMessageAt as lastCustomerMessageAt',
      'a.createdAt as createdAt',
      'a.resolvedAt as resolvedAt',
      'c.firstName as firstName',
      'c.lastName as lastName',
    )) as AlertJoinRow[]

  return rows.map((r) => ({
    id: String(r.id),
    leadId: String(r.leadId),
    leadName: nameFrom(r.firstName, r.lastName),
    conversationId: r.conversationId == null ? null : String(r.conversationId),
    status: r.status,
    waitingMinutes: r.waitingMinutes,
    lastCustomerMessage: r.lastCustomerMessage ?? '',
    lastCustomerMessageAt: r.lastCustomerMessageAt ? new Date(r.lastCustomerMessageAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
    resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
  }))
}

/**
 * Resolves every open alert for a lead. Called inside the outbound-WhatsApp
 * transaction so resolution is atomic with the rep's reply. No-op (returns 0)
 * when the lead has no open alert.
 */
export async function resolveOpenRecoveryAlerts(
  trx: Knex.Transaction,
  args: { agencyId: number; leadId: number; at: Date },
): Promise<number> {
  return trx('recovery_alerts')
    .where({ agencyId: args.agencyId, leadId: args.leadId, status: 'open' })
    .update({ status: 'resolved', resolvedAt: args.at })
}
