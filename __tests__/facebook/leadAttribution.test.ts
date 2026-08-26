/**
 * P0-2 / P0-3 — Lead Ads attribution and Facebook/Instagram separation.
 *
 * The two defects pinned here are the same defect twice: Meta sent the answer
 * and the product discarded it. The webhook carried `form_id`/`ad_id` and the
 * Graph node would have returned campaign and placement, and the ingest read
 * `leadgen_id` alone — so no campaign was ever recorded, and Instagram leads
 * were stored under the Facebook prefix and became uncountable.
 *
 * The invariant under the most pressure is the one about honesty: a value that
 * Meta did not send must stay null. A fabricated campaign name is worse than an
 * absent one, and the classifier must never claim Instagram on a guess.
 */
import { describe, it, expect } from 'vitest'
import {
  buildLeadAttribution,
  channelFromPlatform,
  leadSourceCandidates,
  leadSourceFor,
  LEAD_ATTRIBUTION_GRAPH_FIELDS,
  LEAD_MINIMAL_GRAPH_FIELDS,
} from '@/lib/facebook/leadAttribution'
import { hasAnyAttribution } from '@/db/leadAttribution'

const WEBHOOK = {
  leadgen_id: '900',
  form_id: 'FORM_1',
  adgroup_id: 'AD_1',
  page_id: 'PAGE_FROM_BODY',
  created_time: 1_717_000_000,
}

const GRAPH = {
  field_data: [],
  campaign_id: 'CAMP_1',
  campaign_name: 'Summer Promo',
  adset_id: 'ADSET_1',
  adset_name: 'Retargeting',
  ad_id: 'AD_1',
  ad_name: 'Carousel A',
  form_id: 'FORM_1',
  platform: 'ig',
  is_organic: false,
  created_time: '2026-08-26T09:00:00+0000',
}

describe('graph field sets', () => {
  it('asks for every attribution field alongside field_data', () => {
    for (const f of ['field_data', 'campaign_id', 'campaign_name', 'adset_id', 'ad_id', 'form_id', 'platform']) {
      expect(LEAD_ATTRIBUTION_GRAPH_FIELDS).toContain(f)
    }
  })

  it('keeps the shipped minimal set as exactly field_data', () => {
    // The fallback must stay byte-identical to the pre-existing request, or the
    // "attribution never costs a lead" guarantee is not actually a fallback.
    expect(LEAD_MINIMAL_GRAPH_FIELDS).toBe('field_data')
  })
})

describe('buildLeadAttribution', () => {
  it('captures the complete record when Meta returned everything', () => {
    const a = buildLeadAttribution({
      leadgenId: '900',
      pageId: 'PAGE_VERIFIED',
      webhookValue: WEBHOOK,
      graphNode: GRAPH,
    })

    expect(a).toMatchObject({
      leadgenId: '900',
      formId: 'FORM_1',
      adId: 'AD_1',
      adName: 'Carousel A',
      adsetId: 'ADSET_1',
      adsetName: 'Retargeting',
      campaignId: 'CAMP_1',
      campaignName: 'Summer Promo',
      platform: 'ig',
      isOrganic: false,
    })
    // Tenancy: the verified entry.id wins over anything the body claimed.
    expect(a.pageId).toBe('PAGE_VERIFIED')
    expect(a.externalCreatedAt?.toISOString()).toBe('2026-08-26T09:00:00.000Z')
  })

  it('falls back to webhook fields when the Graph node is absent', () => {
    // The minimal-field fallback path: no campaign, but the ad and form survive.
    const a = buildLeadAttribution({
      leadgenId: '900',
      pageId: 'PAGE_VERIFIED',
      webhookValue: WEBHOOK,
      graphNode: { field_data: [] },
    })

    expect(a.formId).toBe('FORM_1')
    expect(a.adId).toBe('AD_1') // read from adgroup_id
    expect(a.externalCreatedAt?.toISOString()).toBe('2024-05-29T16:26:40.000Z')
    // Never invented.
    expect(a.campaignId).toBeNull()
    expect(a.campaignName).toBeNull()
    expect(a.adName).toBeNull()
    expect(a.platform).toBeNull()
  })

  it('never fabricates a name from an id', () => {
    const a = buildLeadAttribution({
      leadgenId: '900',
      pageId: null,
      webhookValue: { campaign_id: 'CAMP_9' },
      graphNode: {},
    })

    expect(a.campaignId).toBe('CAMP_9')
    expect(a.campaignName).toBeNull()
    expect(a.adsetName).toBeNull()
    expect(a.adName).toBeNull()
  })

  it('is total — garbage in yields nulls, never a throw', () => {
    for (const bad of [null, undefined, 'string', 42, [], true]) {
      const a = buildLeadAttribution({
        leadgenId: '900',
        pageId: null,
        webhookValue: bad,
        graphNode: bad,
      })
      expect(a.leadgenId).toBe('900')
      expect(a.campaignId).toBeNull()
      expect(a.externalCreatedAt).toBeNull()
    }
  })

  it('treats an unparseable timestamp as absence, never as now', () => {
    const a = buildLeadAttribution({
      leadgenId: '900',
      pageId: null,
      webhookValue: { created_time: 'not-a-date' },
      graphNode: {},
    })
    expect(a.externalCreatedAt).toBeNull()
  })

  it('coerces numeric ids to strings without losing precision', () => {
    // Meta ids exceed 2^53; they must survive as text.
    const a = buildLeadAttribution({
      leadgenId: '900',
      pageId: null,
      webhookValue: { ad_id: 23851234567890123 },
      graphNode: { campaign_id: '23851234567890999' },
    })
    expect(typeof a.adId).toBe('string')
    expect(a.campaignId).toBe('23851234567890999')
  })
})

describe('channelFromPlatform — Instagram is claimed only on evidence', () => {
  it('recognises Instagram', () => {
    expect(channelFromPlatform('ig')).toBe('instagram')
    expect(channelFromPlatform('instagram')).toBe('instagram')
    expect(channelFromPlatform('IG')).toBe('instagram')
    expect(channelFromPlatform(' Instagram ')).toBe('instagram')
  })

  it('falls back to Facebook for absent, unknown or explicit Facebook values', () => {
    // The asymmetry is deliberate: mislabelling Facebook as Instagram would
    // corrupt the very report this separation exists to make possible.
    for (const v of [null, undefined, '', '  ', 'fb', 'facebook', 'audience_network', 'messenger', 'whatever']) {
      expect(channelFromPlatform(v)).toBe('facebook')
    }
  })
})

describe('leadSource composition and dedup candidates', () => {
  it('builds the composite source per channel', () => {
    expect(leadSourceFor('facebook', '900')).toBe('facebook:900')
    expect(leadSourceFor('instagram', '900')).toBe('instagram:900')
  })

  it('offers BOTH prefixes as dedup candidates for one leadgen id', () => {
    // A lead ingested before the split is `facebook:900`; the same id
    // redelivered afterwards may resolve to `instagram:900`. Dedup must see both
    // or the redelivery creates a duplicate lead.
    expect(leadSourceCandidates('900')).toEqual(['facebook:900', 'instagram:900'])
  })
})

describe('hasAnyAttribution', () => {
  const empty = {
    leadgenId: '900',
    formId: null,
    adId: null,
    adName: null,
    adsetId: null,
    adsetName: null,
    campaignId: null,
    campaignName: null,
    pageId: 'PAGE_1',
    platform: null,
    isOrganic: null,
    externalCreatedAt: null,
  }

  it('rejects a record that carries nothing beyond what leadSource already says', () => {
    expect(hasAnyAttribution(empty)).toBe(false)
  })

  it('accepts a record carrying even one real provider value', () => {
    expect(hasAnyAttribution({ ...empty, formId: 'FORM_1' })).toBe(true)
    expect(hasAnyAttribution({ ...empty, platform: 'ig' })).toBe(true)
    // `false` is a real answer to "was this organic", not an absence.
    expect(hasAnyAttribution({ ...empty, isOrganic: false })).toBe(true)
  })
})
