import 'server-only'
import { db } from '@/config/db'
import { scopedLeads, type SessionlessScope } from '@/db/briefing'
import type { McpPrincipal } from '@/lib/mcp/scope'

/**
 * Lead readers for MCP tools. Sessionless: everything comes from the server-built
 * McpPrincipal, never from cookies or tool input.
 *
 * Visibility is the product's own predicate, `scopedLeads` (db/briefing.ts):
 * the principal's agency, leads only (lead=true), `userId IN gotPermIds` for
 * non-admins, and the free-plan overQuota withholding. A lead outside that set
 * is indistinguishable from a missing one.
 *
 * PII: no query here ever selects phone, email, secPhone, idNum or any contact
 * identifier, and search matches first/last name only (no reverse lookup).
 */

export const scopeOf = (p: McpPrincipal): SessionlessScope => ({
  user: { role: p.role },
  gotPermIds: p.gotPermIds,
  agencyId: p.agencyId,
})

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export type McpLeadRow = {
  id: number
  firstName: string | null
  lastName: string | null
  status: string | null
  userId: number | null
  nextFollowUpAt: Date | string | null
  lastActivityAt: Date | string | null
}

/**
 * Owner names ("בעל הליד" = clients.userId) for leads the caller can already
 * see, looked up in the SAME agency only. A separate query on purpose:
 * scopedLeads filters on unqualified columns that a users join would make
 * ambiguous, and the visibility predicate is not something to rewrite here.
 */
export async function ownerNamesFor(
  agencyId: number,
  userIds: (number | null)[],
): Promise<Map<number, { firstName: string | null; lastName: string | null }>> {
  const ids = Array.from(new Set(userIds.filter((x): x is number => Number.isInteger(x) && (x as number) > 0)))
  if (ids.length === 0) return new Map()
  const rows = await db('users').where({ agencyId }).whereIn('id', ids).select('id', 'firstName', 'lastName')
  return new Map(rows.map((r: { id: number; firstName: string | null; lastName: string | null }) => [Number(r.id), r]))
}

export async function searchLeadsForMcp(
  p: McpPrincipal,
  o: { query?: string; statuses?: string[]; limit: number },
): Promise<{ rows: McpLeadRow[]; truncated: boolean }> {
  const q = scopedLeads(p.agencyId, p.plan, scopeOf(p))
  if (o.statuses?.length) q.whereIn('status', o.statuses)
  if (o.query) {
    for (const t of o.query.split(/\s+/).filter(Boolean).slice(0, 3)) {
      const like = `%${escapeLike(t)}%`
      // NAME ONLY: phone/email columns are never searched.
      q.where((b) => b.where('firstName', 'ilike', like).orWhere('lastName', 'ilike', like))
    }
  }
  const rows = (await q
    .select('id', 'firstName', 'lastName', 'status', 'userId', 'nextFollowUpAt', 'lastActivityAt')
    .orderByRaw('"lastActivityAt" DESC NULLS LAST')
    .orderBy('id', 'desc')
    .limit(o.limit + 1)) as McpLeadRow[]
  return { rows: rows.slice(0, o.limit), truncated: rows.length > o.limit }
}

export type McpLeadDetailRow = McpLeadRow & {
  leadSource: string | null
  createdAt: Date | string | null
  statusChangedAt: Date | string | null
  followUpNote: string | null
  lastOutcomeType: string | null
}

export async function getLeadForMcp(p: McpPrincipal, leadId: number): Promise<McpLeadDetailRow | null> {
  const row = await scopedLeads(p.agencyId, p.plan, scopeOf(p))
    .where('id', leadId)
    .first(
      'id',
      'firstName',
      'lastName',
      'status',
      'userId',
      'leadSource',
      'createdAt',
      'statusChangedAt',
      'lastActivityAt',
      'nextFollowUpAt',
      'followUpNote',
      'lastOutcomeType',
    )
  return (row as McpLeadDetailRow | undefined) ?? null
}

/** Whether the (already visible) lead has a WhatsApp thread in this agency. */
export async function hasConversationForLead(agencyId: number, leadId: number): Promise<boolean> {
  return !!(await db('inbox_conversations').where({ agencyId, leadId }).first('id'))
}
