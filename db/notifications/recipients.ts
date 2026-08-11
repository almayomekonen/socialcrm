import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import type { RecipientRule } from '@/lib/notifications/types'

/**
 * Recipient resolution — spec §6. SERVER-DERIVED, ALWAYS.
 *
 * The agencyId every lookup here is scoped by originates from either a verified
 * Meta webhook signature or an authenticated session, never from client input,
 * so no client can influence who receives a notification (spec §6.2).
 *
 * `user_perms` is never read or written by this module. Role resolution uses the
 * same ADMIN + GM definition as `isAdmin()` in types/roles, which is what
 * `getPerms` itself branches on — so "admin" means here exactly what it means
 * everywhere else, without reinterpreting the permission model (spec §20.8).
 *
 * BATCHED BY CONSTRUCTION (spec §21.2): two queries per worker pass, regardless
 * of how many jobs the pass claimed. Never a query per notification.
 */

/** ADMIN + GM — the same pair `isAdmin()` treats as administrative. */
const ADMIN_ROLES = [Roles.ADMIN, Roles.GM] as const

export type LeadOwnership = {
  agencyId: number
  leadId: number
  /** The assigned נציג. Null/unassigned ⇒ the admin fallback applies (§6.1). */
  handlerId: number | null
}

export type RecipientContext = {
  /** Key: `${agencyId}:${leadId}` — the agency is part of the key so a lead id
   *  from one tenant can never resolve against another's row. */
  handlerByLead: Map<string, number | null>
  adminsByAgency: Map<number, number[]>
}

export const leadKey = (agencyId: number, leadId: number): string => `${agencyId}:${leadId}`

/**
 * Load handlers for a batch of (agency, lead) pairs in ONE query.
 *
 * Scoped with an explicit tuple predicate rather than `id = ANY(...)` plus a
 * JS-side filter: a bare id list would read rows the batch has no business
 * touching, and pairing them up afterwards would put tenant isolation in
 * application code instead of in the query.
 */
export function loadLeadOwnershipQuery(pairs: { agencyId: number; leadId: number }[]) {
  const tuples = pairs.map(() => '(?,?)').join(',')
  const bindings = pairs.flatMap((p) => [p.agencyId, p.leadId])
  return db.raw(
    `SELECT c.id, c."agencyId", c."handlerId"
       FROM clients c
      WHERE (c."agencyId", c.id) IN (${tuples})`,
    bindings,
  )
}

export async function loadLeadOwnership(pairs: { agencyId: number; leadId: number }[]): Promise<LeadOwnership[]> {
  if (pairs.length === 0) return []
  const res = await loadLeadOwnershipQuery(pairs)
  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    agencyId: Number(r.agencyId),
    leadId: Number(r.id),
    handlerId: r.handlerId == null ? null : Number(r.handlerId),
  }))
}

/**
 * Load ADMIN + GM users for a batch of agencies in ONE query.
 *
 * Suspended users are excluded: they cannot reach the application at all
 * (`requireUser` throws, the app layout redirects), so a notification addressed
 * to one could never be read. Same definition of "eligible recipient" already
 * used by lib/emailAutomations/recipients.ts and db/automations/leadFacts.ts.
 */
export function loadAgencyAdminsQuery(agencyIds: number[]) {
  return db('users')
    .select('id', 'agencyId')
    .whereIn('agencyId', agencyIds)
    .whereIn('role', ADMIN_ROLES as unknown as string[])
    .where('suspended', false)
}

export async function loadAgencyAdmins(agencyIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>()
  if (agencyIds.length === 0) return out
  const rows = (await loadAgencyAdminsQuery(agencyIds)) as { id: number; agencyId: number }[]
  for (const row of rows) {
    const list = out.get(Number(row.agencyId)) ?? []
    list.push(Number(row.id))
    out.set(Number(row.agencyId), list)
  }
  return out
}

/**
 * Build the whole pass's recipient context up front — two queries total.
 *
 * `leadPairs` carries the lead behind each job: the lead itself for lead-entity
 * events, or the conversation's lead for conversation-entity events.
 */
export async function buildRecipientContext(input: {
  leadPairs: { agencyId: number; leadId: number }[]
  agencyIds: number[]
}): Promise<RecipientContext> {
  const [ownership, adminsByAgency] = await Promise.all([
    loadLeadOwnership(input.leadPairs),
    loadAgencyAdmins(input.agencyIds),
  ])
  const handlerByLead = new Map<string, number | null>()
  for (const row of ownership) handlerByLead.set(leadKey(row.agencyId, row.leadId), row.handlerId)
  return { handlerByLead, adminsByAgency }
}

/**
 * The rule, applied. PURE — every fact comes from the pre-loaded context, which
 * is what makes recipient behavior testable from fixtures without a database
 * (spec §22.1).
 *
 * `handler_or_admin` falls back to admins ONLY when the lead is genuinely
 * unassigned. It does not fall back when the lead is missing from the context:
 * an absent lead means the lead no longer exists (or was never in this agency),
 * and notifying every admin about a lead nobody can open would be noise, not
 * safety.
 */
export function resolveRecipients(input: {
  rule: RecipientRule
  agencyId: number
  leadId: number | null
  context: RecipientContext
}): number[] {
  const { rule, agencyId, leadId, context } = input
  const admins = context.adminsByAgency.get(agencyId) ?? []

  if (rule === 'admin_only') return dedupe(admins)

  if (leadId == null) return []
  const key = leadKey(agencyId, leadId)
  if (!context.handlerByLead.has(key)) return []

  const handlerId = context.handlerByLead.get(key) ?? null
  return handlerId != null ? [handlerId] : dedupe(admins)
}

function dedupe(ids: number[]): number[] {
  return Array.from(new Set(ids))
}
