import 'server-only'
import { db } from '@/config/db'
import { relationshipFrom, type CrmContext, type MeetingFact } from './crmContextFormat'

export { formatCrmContextBlock, relationshipFrom, type CrmContext, type MeetingFact, type Relationship } from './crmContextFormat'

/**
 * What SocialCRM already knows about THIS sender, for the conversational agent.
 * Read-only. Every query names both the agency and the lead (or the agency and
 * the conversation's own lead id), and nothing here reads another contact.
 * Three single-table reads; no join, no write.
 *
 * RELATIONSHIP, from CRM evidence only (never from how the person writes):
 *   existing_customer  lead status 'closed' (in SocialCRM a closed lead IS a
 *                      client), or at least one deal of this lead with a sale
 *                      date (`sales."saleDt"`): a sale actually happened.
 *   lost               lead status 'lost'. NOT a customer, and never treated as one.
 *   prospect           any other lead (new / contacted / interested).
 *   contact            a WhatsApp Contact with no lead: nothing is known.
 */

export async function loadCrmContext(input: { agencyId: number; leadId: number | null; nowMs: number }): Promise<CrmContext> {
  const { agencyId, leadId, nowMs } = input
  if (!leadId || !Number.isSafeInteger(leadId) || leadId <= 0) {
    return { relationship: 'contact', leadStatus: null, completedSales: 0, lastSaleAtMs: null, nextMeeting: null, lastMeeting: null }
  }
  const now = new Date(nowMs)
  const [lead, sales, next, last] = await Promise.all([
    db('clients').where({ id: leadId, agencyId }).first('id', 'status') as Promise<{ id: number; status: string | null } | undefined>,
    db('sales')
      .where({ clientId: leadId, agencyId })
      .whereNotNull('saleDt')
      .count<{ n: string | number }[]>({ n: '*' })
      .max<{ last: Date | null }[]>({ last: 'saleDt' }),
    db('meetings')
      .where({ lead_id: leadId, agency_id: agencyId, status: 'scheduled' })
      .where('start_at', '>', now)
      .orderBy('start_at', 'asc')
      .first('start_at', 'title', 'status'),
    db('meetings')
      .where({ lead_id: leadId, agency_id: agencyId })
      .whereIn('status', ['scheduled', 'completed', 'no_show'])
      .where('start_at', '<=', now)
      .orderBy('start_at', 'desc')
      .first('start_at', 'title', 'status'),
  ])
  if (!lead) {
    // The lead is not this agency's: nothing about it may reach the prompt.
    return { relationship: 'contact', leadStatus: null, completedSales: 0, lastSaleAtMs: null, nextMeeting: null, lastMeeting: null }
  }
  const s = (sales as unknown as Array<{ n: string | number; last: Date | null }>)[0] ?? { n: 0, last: null }
  const completedSales = Number(s.n) || 0
  const meeting = (m: { start_at: Date; title: string | null; status: string } | undefined): MeetingFact | null =>
    m ? { startAtMs: new Date(m.start_at).getTime(), title: String(m.title ?? '').slice(0, 120), status: m.status } : null
  const leadStatus = lead.status ?? null
  return {
    relationship: relationshipFrom(leadStatus, completedSales, true),
    leadStatus,
    completedSales,
    lastSaleAtMs: s.last ? new Date(s.last).getTime() : null,
    nextMeeting: meeting(next),
    lastMeeting: meeting(last),
  }
}
