/**
 * Recovery Engine — detects leads being ignored so the business can recover them
 * before they're lost.
 *
 * SocialCRM is the source of truth. This service holds the business logic; the
 * API route ({@link file://app/api/automation/recovery-leads/route.ts}) is a thin
 * caller, and n8n only orchestrates (schedule → HTTP → here → process results).
 *
 * "Waiting for reply" is read straight off the denormalized columns the inbox
 * already maintains on every message (see db/inboxConversations.ts bump fns):
 *   - lastDirection === 'inbound'  → the customer sent the latest message and no
 *                                    agent has replied after it.
 *   - state === 'open'             → conversation is neither 'archived' nor 'closed'.
 *   - lastInboundAt                → when the customer last wrote (the wait clock).
 * No per-message scan is needed, so this is cheap enough to run every 10 minutes.
 *
 * FUTURE PHASES (not implemented — architecture only):
 *   This service is the single seam where recovery intelligence will grow. Each
 *   future capability layers on the same `WaitingLead` rows without changing the
 *   query or the route:
 *     - AI suggested recovery message  → enrich(rows) → add `suggestedMessage`
 *     - Lead scoring / revenue-at-risk → enrich(rows) → add `riskScore`, `revenueAtRisk`
 *     - Automatic follow-up / tasks    → a separate writer service consuming these rows
 *   Keep this module read-only; writers/enrichers belong in sibling files under
 *   services/automation/ so the detection query stays a pure, testable unit.
 */
import { db } from '@/config/db'

export const DEFAULT_WAITING_THRESHOLD_MINUTES = 30

const MAX_RESULTS = 500

const TERMINAL_STATUSES = ['closed', 'lost']

export interface WaitingLead {
  leadId: string
  leadName: string
  conversationId: string
  agencyId: number
  waitingMinutes: number
  lastCustomerMessage: string
  lastCustomerMessageAt: string // ISO 8601
}

export interface GetLeadsWaitingOptions {
  /** Minutes since the customer's last message. Defaults to 30; clamped to [1, 1440]. */
  thresholdMinutes?: number
  /** Restrict to one tenant; omit for platform-wide (every agency). */
  agencyId?: number
  /** Row cap; defaults to and is clamped at {@link MAX_RESULTS}. */
  limit?: number
}

interface WaitingRow {
  conversationId: number | string
  leadId: number
  agencyId: number
  firstName: string | null
  lastName: string | null
  customerName: string | null
  lastMessageText: string | null
  lastInboundAt: string | Date
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function resolveLeadName(row: WaitingRow): string {
  const full = [row.firstName, row.lastName].filter(Boolean).join(' ').trim()
  return full || row.customerName?.trim() || 'ליד'
}

export async function getLeadsWaitingForReply(options: GetLeadsWaitingOptions = {}): Promise<WaitingLead[]> {
  const thresholdMinutes = clamp(options.thresholdMinutes, DEFAULT_WAITING_THRESHOLD_MINUTES, 1, 1440)
  const limit = clamp(options.limit, MAX_RESULTS, 1, MAX_RESULTS)
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000)

  const query = db('inbox_conversations as cv')
    .join('clients as c', 'c.id', 'cv.leadId')
    .where('cv.state', 'open')
    .where('cv.lastDirection', 'inbound')
    .whereNotNull('cv.lastInboundAt')
    .where('cv.lastInboundAt', '<', cutoff)

    .where((b) => b.whereNull('c.status').orWhereNotIn('c.status', TERMINAL_STATUSES))
    .select(
      'cv.id as conversationId',
      'cv.leadId as leadId',
      'cv.agencyId as agencyId',
      'cv.lastMessageText as lastMessageText',
      'cv.lastInboundAt as lastInboundAt',
      'c.firstName as firstName',
      'c.lastName as lastName',
      'cv.customerName as customerName',
    )
    .orderBy('cv.lastInboundAt', 'asc')
    .limit(limit)

  if (options.agencyId != null) query.where('cv.agencyId', options.agencyId)

  const rows = (await query) as WaitingRow[]
  const now = Date.now()

  return rows.map((row) => {
    const at = new Date(row.lastInboundAt)
    return {
      leadId: String(row.leadId),
      leadName: resolveLeadName(row),
      conversationId: String(row.conversationId),
      agencyId: row.agencyId,
      waitingMinutes: Math.max(0, Math.round((now - at.getTime()) / 60_000)),
      lastCustomerMessage: row.lastMessageText ?? '',
      lastCustomerMessageAt: at.toISOString(),
    }
  })
}
