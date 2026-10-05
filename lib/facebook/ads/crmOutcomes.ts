/**
 * SocialCRM outcomes of leads that came from Meta ads — pure, no DB, no Graph.
 *
 * THREE KINDS OF NUMBER, NEVER MIXED (the attribution rules of this feature):
 *   META METRICS      — reported by the Marketing API (spend, Meta's `lead`).
 *   SOCIALCRM METRICS — leads actually persisted in SocialCRM.
 *   ATTRIBUTED CRM    — only CRM leads whose `lead_attribution` row carries the
 *                       Meta campaign/ad ids. A lead without ids is NEVER
 *                       assigned to a campaign by name, time or guess.
 *
 * Statuses use the PERSISTED vocabulary (lib/leads/statusStyles.ts):
 *   new | contacted | interested | closed | lost
 * plus the legacy Hebrew aliases kept in lib/ai/leadStatuses.ts. Per the
 * product model a `closed` lead became a customer. Anything else (e.g. the
 * historical default 'true') is counted as `unknownStatus`, not forced into a
 * bucket.
 */

export type CrmStage = 'new' | 'contacted' | 'interested' | 'closed' | 'lost' | 'unknown'

const STAGE_OF: Record<string, CrmStage> = {
  new: 'new',
  contacted: 'contacted',
  interested: 'interested',
  closed: 'closed',
  lost: 'lost',
  // Legacy aliases (lib/ai/leadStatuses.ts).
  חדש: 'new',
  בטיפול: 'contacted',
  'ממתין לתשובה': 'contacted',
  סגורה: 'closed',
  'הסתיים טיפול': 'closed',
  'לא רלוונטי': 'lost',
  'לא מעוניין': 'lost',
}

export function crmStage(status: string | null | undefined): CrmStage {
  return (status && STAGE_OF[status.trim()]) || 'unknown'
}

/** One attributed SocialCRM lead, as the outcomes query returns it. */
export type AttributedLead = {
  leadId: number
  campaignId: string | null
  campaignName: string | null
  adsetId: string | null
  adsetName: string | null
  adId: string | null
  adName: string | null
  status: string | null
  nextFollowUpAt: Date | string | null
}

export type CrmOutcome = {
  /** Leads persisted in SocialCRM with this object's Meta id. */
  captured: number
  /** Still `new`: nobody has worked them yet. */
  untouched: number
  contacted: number
  interested: number
  /** `closed` — the lead became a customer. */
  closed: number
  lost: number
  unknownStatus: number
  /** Open leads (not closed/lost) with a follow-up scheduled in the future. */
  followUpScheduled: number
}

export const EMPTY_OUTCOME: CrmOutcome = {
  captured: 0,
  untouched: 0,
  contacted: 0,
  interested: 0,
  closed: 0,
  lost: 0,
  unknownStatus: 0,
  followUpScheduled: 0,
}

/** Worked on in any way: everything past `new` (including closed and lost). */
export const handledCount = (o: CrmOutcome) => o.contacted + o.interested + o.closed + o.lost

export type OutcomeLevel = 'campaign' | 'adset' | 'ad'

const ID_OF: Record<OutcomeLevel, keyof AttributedLead> = { campaign: 'campaignId', adset: 'adsetId', ad: 'adId' }
const NAME_OF: Record<OutcomeLevel, keyof AttributedLead> = { campaign: 'campaignName', adset: 'adsetName', ad: 'adName' }

export type CrmOutcomeGroup = { id: string; name: string | null; outcome: CrmOutcome }

/**
 * Group attributed leads by the Meta object at `level`. A lead with no id at
 * that level is not counted anywhere (it is reported separately by the caller
 * as "without attribution", never folded into a campaign).
 */
export function groupOutcomes(leads: AttributedLead[], level: OutcomeLevel, now: Date): Map<string, CrmOutcomeGroup> {
  const groups = new Map<string, CrmOutcomeGroup>()
  const idKey = ID_OF[level]
  const nameKey = NAME_OF[level]
  for (const lead of leads) {
    const id = lead[idKey]
    if (typeof id !== 'string' || !id) continue
    let g = groups.get(id)
    if (!g) {
      g = { id, name: null, outcome: { ...EMPTY_OUTCOME } }
      groups.set(id, g)
    }
    const name = lead[nameKey]
    if (!g.name && typeof name === 'string' && name) g.name = name
    addLead(g.outcome, lead, now)
  }
  return groups
}

function addLead(o: CrmOutcome, lead: AttributedLead, now: Date) {
  o.captured++
  const stage = crmStage(lead.status)
  if (stage === 'new') o.untouched++
  else if (stage === 'unknown') o.unknownStatus++
  else o[stage]++
  const open = stage !== 'closed' && stage !== 'lost'
  const next = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).getTime() : NaN
  if (open && Number.isFinite(next) && next > now.getTime()) o.followUpScheduled++
}

/**
 * Spend ÷ leads that were CAPTURED IN SOCIALCRM for the same object and period.
 * A different number from Meta's cost per lead, and always labelled as such.
 * Null without spend or without captured leads (no cost per nothing).
 */
export function costPerCapturedLead(spend: number | null, outcome: CrmOutcome | undefined): number | null {
  if (spend === null || spend <= 0 || !outcome || outcome.captured <= 0) return null
  return spend / outcome.captured
}
