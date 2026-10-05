import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { AttributedLead } from '@/lib/facebook/ads/crmOutcomes'
import type { DayRange } from '@/lib/facebook/ads/periods'

/**
 * Attributed SocialCRM leads for one agency and one period — the read behind
 * every "SocialCRM" number in the ads report.
 *
 * TENANCY. Both sides of the join carry the agency: `lead_attribution` is
 * filtered by the session's agency AND joined to `clients` on (id, agencyId),
 * so a mismatched row could never contribute a lead from another tenant.
 *
 * PERIOD. A lead belongs to the day Meta created it (`externalCreatedAt`,
 * falling back to when we recorded the attribution), read in the AD ACCOUNT's
 * timezone — the same calendar days Meta used for the spend beside it.
 *
 * Bounded: an agency's ad leads for a reporting period are hundreds at most;
 * MAX_ROWS keeps a pathological account from turning a page view into a dump.
 */

export const MAX_ROWS = 5000

const COLUMNS = [
  'la.leadId as leadId',
  'la.campaignId as campaignId',
  'la.campaignName as campaignName',
  'la.adsetId as adsetId',
  'la.adsetName as adsetName',
  'la.adId as adId',
  'la.adName as adName',
  'c.status as status',
  'c.nextFollowUpAt as nextFollowUpAt',
] as const

export function attributedLeadsQuery(
  knex: Knex,
  agencyId: number,
  period: DayRange,
  timeZone: string,
  filter: { campaignId?: string | null; adsetId?: string | null } = {},
) {
  let q = knex('lead_attribution as la')
    .join('clients as c', function () {
      this.on('c.id', '=', 'la.leadId').andOn('c.agencyId', '=', 'la.agencyId')
    })
    .where('la.agencyId', agencyId)
    .where('la.provider', 'meta')
    .whereRaw(`(timezone(?, COALESCE(la."externalCreatedAt", la."createdAt")))::date BETWEEN ?::date AND ?::date`, [
      timeZone,
      period.since,
      period.until,
    ])
  if (filter.campaignId) q = q.where('la.campaignId', filter.campaignId)
  if (filter.adsetId) q = q.where('la.adsetId', filter.adsetId)
  return q
    .orderBy('la.leadId', 'desc')
    .limit(MAX_ROWS)
    .select(...COLUMNS)
}

/** A timezone Postgres will accept, else the business default. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'Asia/Jerusalem'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'Asia/Jerusalem'
  }
}

export async function listAttributedLeads(
  agencyId: number,
  period: DayRange,
  timeZone: string | null,
  filter: { campaignId?: string | null; adsetId?: string | null } = {},
): Promise<AttributedLead[]> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return []
  return (await attributedLeadsQuery(db, agencyId, period, safeTimeZone(timeZone), filter)) as AttributedLead[]
}

export type LeadAdAttribution = {
  campaignId: string | null
  campaignName: string | null
  adsetName: string | null
  adId: string | null
  adName: string | null
  formId: string | null
  platform: string | null
  isOrganic: boolean | null
}

/** One lead's Meta attribution, for the lead page. Agency-scoped; null when there is none. */
export async function getLeadAdAttribution(agencyId: number, leadId: number): Promise<LeadAdAttribution | null> {
  if (!Number.isInteger(agencyId) || agencyId <= 0 || !Number.isInteger(leadId) || leadId <= 0) return null
  const row = await db('lead_attribution')
    .where({ agencyId, leadId, provider: 'meta' })
    .first('campaignId', 'campaignName', 'adsetName', 'adId', 'adName', 'formId', 'platform', 'isOrganic')
  return (row as LeadAdAttribution | undefined) ?? null
}
