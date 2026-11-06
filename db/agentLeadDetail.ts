import { db } from '@/config/db'
import type { LeadKey } from './clients'

/**
 * The lead-detail reads behind `getLeadIntelligenceInputs`, for a caller that
 * SUPPLIES the agency instead of having it read from the request session.
 *
 * WHY THESE EXIST. `getFullLead`, `getFamMembers` and `get5TasksByClientId`
 * each call `requireUser()`. On a sessionless path (the WhatsApp owner
 * assistant, autonomous investigations) that throws, and the Agent's `get_lead`
 * then answered from a lead with no source, handler, activity, tasks or notes.
 * Threading an agency through those three would touch every one of their
 * interactive callers, so the sessionless path gets its own reads here and the
 * interactive ones are unchanged.
 *
 * AUTHORIZATION IS THE CALLER'S. Like `getFullLead`, these scope to the agency
 * only. `get_lead` calls them strictly AFTER `getNamedLeadById`, which applies
 * agency, rep visibility, role, plan and `lead = true`. A new caller must gate
 * the lead the same way first.
 *
 * TENANCY. Every query is pinned to `clients.agencyId`. `tasks` has no agency
 * column (a task's tenant IS its lead's), so tasks are read through their lead.
 */

export async function getLeadForAgency(agencyId: number, leadId: number, select: LeadKey[]) {
  const lead = await db('clients as c')
    .join('clients_info as ci', 'c.id', 'ci.id')
    .where('c.id', leadId)
    .where('c.agencyId', agencyId)
    .select(select.filter((col) => col !== 'idFiles'))
    .first()
  return lead ? { ...lead, id: leadId } : undefined
}

/** The lead's family members in the same agency (same rows `getFamMembers` returns). */
export async function getFamilyMembersForAgency(agencyId: number, leadId: number) {
  const familyId = (await db('clients').where({ id: leadId, agencyId }).select('familyId').first())?.familyId
  if (!familyId) return []
  return db('clients').where({ familyId, agencyId }).select('id')
}

/** The lead's five most recently updated tasks (same rows `get5TasksByClientId` returns). */
export async function getRecentLeadTasksForAgency(agencyId: number, leadId: number) {
  return db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .where('t.clientId', leadId)
    .where('c.agencyId', agencyId)
    .orderBy('t.updatedAt', 'desc')
    .limit(5)
    .select('t.*')
}
