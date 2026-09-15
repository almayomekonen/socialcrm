import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { platformOwnerEmails } from '@/lib/auth/platformOwner'
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
  /**
   * Users on the platform-owner allowlist. Loaded ONLY when the pass actually
   * claimed a job that needs them, so the ordinary two-query pass stays two
   * queries.
   *
   * OPTIONAL, and absent means the same thing as empty: nobody. Every existing
   * caller and fixture predates platform-level types and legitimately has no
   * opinion here, so requiring the field would have forced an edit through eight
   * unrelated test files to express "still nobody". Absent ⇒ `[]` ⇒ no
   * recipients ⇒ nothing delivered, which is the fail-closed answer.
   */
  platformOperatorIds?: number[]
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
 * Users on the platform-owner allowlist — the recipients of PLATFORM facts,
 * never of an agency's own work.
 *
 * Identity comes from `platformOwnerEmails()` (lib/auth/platformOwner.ts), the
 * SAME deny-by-default allowlist that already gates /admin. Reusing it is the
 * point: there is exactly one definition of "who runs SocialCRM", so this can
 * never drift from the surfaces that answer the same question.
 *
 * Suspended users are excluded on the same reasoning as `loadAgencyAdmins` — a
 * user who cannot reach the application cannot read what is addressed to them.
 *
 * Email comparison is lower-cased on both sides: `platformOwnerEmails()` already
 * normalises, and `users.email` is compared with `lower()` so a differently-cased
 * stored address still matches.
 */
export function loadPlatformOperatorsQuery(emails: string[]) {
  return db('users').select('id', 'agencyId').whereRaw('lower(email) = ANY(?)', [emails]).where('suspended', false)
}

export async function loadPlatformOperators(): Promise<{ id: number; agencyId: number | null }[]> {
  const emails = platformOwnerEmails()
  if (emails.length === 0) return []
  const rows = (await loadPlatformOperatorsQuery(emails)) as { id: number; agencyId: number | null }[]
  return rows.map((r) => ({ id: Number(r.id), agencyId: r.agencyId == null ? null : Number(r.agencyId) }))
}

/**
 * Build the whole pass's recipient context up front — two queries total, plus a
 * third ONLY when the pass claimed a job that targets the platform operator.
 *
 * `leadPairs` carries the lead behind each job: the lead itself for lead-entity
 * events, or the conversation's lead for conversation-entity events.
 */
export async function buildRecipientContext(input: {
  leadPairs: { agencyId: number; leadId: number }[]
  agencyIds: number[]
  /** True when at least one claimed job's type resolves to `platform_operator`. */
  needPlatformOperators?: boolean
}): Promise<RecipientContext> {
  const [ownership, adminsByAgency, operators] = await Promise.all([
    loadLeadOwnership(input.leadPairs),
    loadAgencyAdmins(input.agencyIds),
    input.needPlatformOperators ? loadPlatformOperators() : Promise.resolve([]),
  ])
  const handlerByLead = new Map<string, number | null>()
  for (const row of ownership) handlerByLead.set(leadKey(row.agencyId, row.leadId), row.handlerId)
  return { handlerByLead, adminsByAgency, platformOperatorIds: operators.map((o) => o.id) }
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
  /** Business facts from the emission site. Only `explicit_user` reads it. */
  payload?: { assignedUserId?: number | null }
}): number[] {
  const { rule, agencyId, leadId, context, payload } = input

  /**
   * ADDRESSED TO ONE NAMED USER, carried on the payload.
   *
   * Every other rule resolves from the database, which is what keeps them
   * tenant-safe. This one cannot: a bulk assignment has no single lead whose
   * handler identifies the recipient. The emission site therefore MUST verify
   * that the user belongs to the acting agency before emitting — `assignLeadsToRep`
   * does, in the same transaction that moves the rows.
   *
   * Safe because payloads are server-authored: no client input reaches this
   * field. It is not a general-purpose "notify anyone" hatch, and a new caller
   * must repeat that agency check.
   */
  if (rule === 'explicit_user') {
    const target = payload?.assignedUserId
    return typeof target === 'number' && target > 0 ? [target] : []
  }
  const admins = context.adminsByAgency.get(agencyId) ?? []

  /**
   * PLATFORM, NOT TENANT. Resolves ONLY from the platform-owner allowlist and
   * never consults `admins` — an agency administrator must never receive a
   * platform billing fact, and no fallback to one exists. An empty list returns
   * empty, which the planner turns into `skip: 'no_recipients'`: nobody is
   * notified rather than the wrong person being notified.
   */
  if (rule === 'platform_operator') return dedupe(context.platformOperatorIds ?? [])

  if (rule === 'admin_only') return dedupe(admins)

  /**
   * A CONVERSATION that may or may not have a ליד yet (Messenger). With a ליד it
   * is exactly `handler_or_admin`. Without one it goes to the admins, who route
   * unowned inbound work — unlike `handler_or_admin`, whose entity IS the lead and
   * therefore has nobody to tell when the lead is absent. A ליד id the context does
   * not know (deleted, or not this agency's) also goes to the admins: the
   * conversation still exists and still needs an owner.
   */
  if (rule === 'lead_handler_or_admins') {
    const handlerId = leadId == null ? null : (context.handlerByLead.get(leadKey(agencyId, leadId)) ?? null)
    return handlerId != null ? [handlerId] : dedupe(admins)
  }

  if (leadId == null) return []
  const key = leadKey(agencyId, leadId)
  if (!context.handlerByLead.has(key)) return []

  const handlerId = context.handlerByLead.get(key) ?? null
  return handlerId != null ? [handlerId] : dedupe(admins)
}

function dedupe(ids: number[]): number[] {
  return Array.from(new Set(ids))
}
