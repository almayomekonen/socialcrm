/**
 * SocialCRM outcomes of Meta-attributed leads, and the rules that keep Meta's
 * numbers and SocialCRM's numbers apart.
 */
import { describe, expect, it } from 'vitest'
import {
  costPerCapturedLead,
  crmStage,
  EMPTY_OUTCOME,
  groupOutcomes,
  handledCount,
  type AttributedLead,
} from '@/lib/facebook/ads/crmOutcomes'
import { adsSignals, CAPTURE_GAP_MIN } from '@/lib/facebook/ads/signals'

const NOW = new Date('2026-10-06T10:00:00Z')
const lead = (over: Partial<AttributedLead> = {}): AttributedLead => ({
  leadId: 1,
  campaignId: 'C1',
  campaignName: 'קמפיין א',
  adsetId: 'S1',
  adsetName: 'קבוצה',
  adId: 'A1',
  adName: 'מודעה',
  status: 'new',
  nextFollowUpAt: null,
  ...over,
})

describe('crmStage — current status semantics', () => {
  it.each([
    ['new', 'new'],
    ['contacted', 'contacted'],
    ['interested', 'interested'],
    ['closed', 'closed'],
    ['lost', 'lost'],
    ['חדש', 'new'],
    ['בטיפול', 'contacted'],
    ['סגורה', 'closed'],
    ['לא רלוונטי', 'lost'],
  ])('%s → %s', (status, stage) => {
    expect(crmStage(status)).toBe(stage)
  })

  it('an unrecognised status (e.g. the legacy default "true") is unknown — never forced into a bucket', () => {
    expect(crmStage('true')).toBe('unknown')
    expect(crmStage(null)).toBe('unknown')
  })
})

describe('groupOutcomes — aggregation', () => {
  const leads = [
    lead({ leadId: 1, status: 'new' }),
    lead({ leadId: 2, status: 'new', nextFollowUpAt: '2026-10-07T09:00:00Z' }),
    lead({ leadId: 3, status: 'contacted', nextFollowUpAt: '2026-10-05T09:00:00Z' }), // past follow-up
    lead({ leadId: 4, status: 'interested' }),
    lead({ leadId: 5, status: 'closed', nextFollowUpAt: '2026-10-09T09:00:00Z' }), // closed: not "scheduled"
    lead({ leadId: 6, status: 'lost' }),
    lead({ leadId: 7, status: 'true' }),
    lead({ leadId: 8, campaignId: 'C2', campaignName: 'קמפיין ב', adsetId: 'S2', adId: 'A2', status: 'contacted' }),
  ]

  it('counts every stage of one campaign, and follow-ups only for open leads in the future', () => {
    const c1 = groupOutcomes(leads, 'campaign', NOW).get('C1')!
    expect(c1.name).toBe('קמפיין א')
    expect(c1.outcome).toEqual({
      captured: 7,
      untouched: 2,
      contacted: 1,
      interested: 1,
      closed: 1,
      lost: 1,
      unknownStatus: 1,
      followUpScheduled: 1,
    })
    expect(handledCount(c1.outcome)).toBe(4)
  })

  it('groups at ad set and ad level by their own ids', () => {
    expect(groupOutcomes(leads, 'adset', NOW).get('S2')!.outcome.captured).toBe(1)
    expect(groupOutcomes(leads, 'ad', NOW).get('A1')!.outcome.captured).toBe(7)
  })

  it('a lead with no id at that level is never assigned to any campaign', () => {
    const groups = groupOutcomes([lead({ campaignId: null }), lead({ campaignId: '' })], 'campaign', NOW)
    expect(groups.size).toBe(0)
  })
})

describe('Meta numbers vs SocialCRM numbers', () => {
  it('cost per CAPTURED lead uses captured leads, and is null without spend or captures', () => {
    const outcome = { ...EMPTY_OUTCOME, captured: 4 }
    expect(costPerCapturedLead(100, outcome)).toBe(25)
    expect(costPerCapturedLead(null, outcome)).toBeNull()
    expect(costPerCapturedLead(0, outcome)).toBeNull()
    expect(costPerCapturedLead(100, { ...EMPTY_OUTCOME })).toBeNull()
    expect(costPerCapturedLead(100, undefined)).toBeNull()
  })
})

describe('adsSignals — facts only', () => {
  const base = { id: 'C1', name: 'קמפיין א', spend: 500, metaLeads: 10, leadObjective: true }

  it('says how many leads are still untouched, in neutral words', () => {
    const s = adsSignals([{ ...base, crm: { ...EMPTY_OUTCOME, captured: 10, untouched: 4 } }], 'ILS')
    expect(s).toEqual([{ kind: 'untouched', campaignId: 'C1', text: '4 לידים מהקמפיין "קמפיין א" עדיין לא טופלו' }])
  })

  it('spend with zero Meta leads is a signal only for a lead campaign', () => {
    expect(adsSignals([{ ...base, metaLeads: 0, crm: undefined }], 'ILS').map((x) => x.kind)).toEqual(['spend_no_leads'])
    expect(adsSignals([{ ...base, metaLeads: 0, leadObjective: false, crm: undefined }], 'ILS')).toEqual([])
  })

  it('an unknown Meta lead count is never read as zero', () => {
    expect(adsSignals([{ ...base, metaLeads: null, crm: undefined }], 'ILS')).toEqual([])
  })

  it('a capture gap must be both absolute and proportional to be worth reading', () => {
    const gap = (metaLeads: number, captured: number) =>
      adsSignals([{ ...base, metaLeads, crm: { ...EMPTY_OUTCOME, captured, contacted: captured } }], 'ILS').filter(
        (x) => x.kind === 'capture_gap',
      )
    expect(gap(10, 10 - CAPTURE_GAP_MIN)).toHaveLength(1)
    expect(gap(10, 8)).toHaveLength(0)
    expect(gap(100, 90)).toHaveLength(0)
  })

  it('nothing true and useful to say → no signals', () => {
    expect(adsSignals([{ ...base, crm: { ...EMPTY_OUTCOME, captured: 10, contacted: 10 } }], 'ILS')).toEqual([])
  })
})
