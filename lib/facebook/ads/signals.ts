import { formatAdsCount, formatAdsMoney } from '@/lib/facebook/ads/format'
import type { CrmOutcome } from '@/lib/facebook/ads/crmOutcomes'

/**
 * "שימו לב" — factual operational signals, never advice. Pure.
 *
 * Each signal states a fact the numbers prove, in neutral words, and stops
 * there: no recommendation, no blame on Meta or on the team. Thresholds are
 * deliberately conservative so a signal is worth reading (care-charter Law 5:
 * proportion). Ordered by what is most actionable inside SocialCRM.
 */

export type SignalInput = {
  id: string
  name: string
  /** Meta: spend for the period (null = unknown). */
  spend: number | null
  /** Meta: its own `lead` count (null = unknown / not a lead campaign). */
  metaLeads: number | null
  /** Whether the campaign optimises for leads (so "no leads" is meaningful). */
  leadObjective: boolean
  /** SocialCRM: attributed outcomes (undefined = none captured). */
  crm: CrmOutcome | undefined
}

export type AdsSignal = {
  kind: 'untouched' | 'spend_no_leads' | 'capture_gap'
  campaignId: string
  text: string
}

/** Meta reported this many more leads than were captured — worth a look only past both bounds. */
export const CAPTURE_GAP_MIN = 3
export const CAPTURE_GAP_SHARE = 0.25

export function adsSignals(rows: SignalInput[], currency: string | null): AdsSignal[] {
  const untouched: AdsSignal[] = []
  const spendNoLeads: AdsSignal[] = []
  const gaps: AdsSignal[] = []
  for (const r of rows) {
    if (r.crm && r.crm.untouched > 0) {
      untouched.push({
        kind: 'untouched',
        campaignId: r.id,
        text:
          r.crm.untouched === 1
            ? `ליד אחד מהקמפיין "${r.name}" עדיין לא טופל`
            : `${formatAdsCount(r.crm.untouched)} לידים מהקמפיין "${r.name}" עדיין לא טופלו`,
      })
    }
    if (r.leadObjective && r.spend !== null && r.spend > 0 && r.metaLeads === 0) {
      spendNoLeads.push({
        kind: 'spend_no_leads',
        campaignId: r.id,
        text: `בקמפיין "${r.name}" הוצאו ${formatAdsMoney(r.spend, currency)} בתקופה, ו-Meta לא דיווחה על לידים`,
      })
    }
    const captured = r.crm?.captured ?? 0
    if (r.metaLeads !== null && r.metaLeads > 0) {
      const gap = r.metaLeads - captured
      if (gap >= CAPTURE_GAP_MIN && gap >= r.metaLeads * CAPTURE_GAP_SHARE) {
        gaps.push({
          kind: 'capture_gap',
          campaignId: r.id,
          text: `בקמפיין "${r.name}" Meta דיווחה על ${formatAdsCount(r.metaLeads)} לידים, וב-SocialCRM נקלטו ${formatAdsCount(captured)}`,
        })
      }
    }
  }
  return [...untouched, ...spendNoLeads, ...gaps]
}
