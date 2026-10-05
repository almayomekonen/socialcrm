/**
 * Meta Ads intelligence against a real Postgres: tenant isolation of every new
 * read and write, period bucketing in the ad account's timezone, the remembered
 * account, and the snapshot cache.
 *
 * Run: npm run test:db -- __tests__/adsReporting/adsIntelligence.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { getLeadAdAttribution, listAttributedLeads } from '@/db/adsCrmOutcomes'
import { readCreativeForAd, readSnapshot, writeSnapshot } from '@/db/adsSnapshots'
import { getAdConnection, saveAdConnection, setSelectedAdAccount } from '@/db/facebookAds'
import { groupOutcomes } from '@/lib/facebook/ads/crmOutcomes'
import { loadCrmOnlyCampaigns } from '@/lib/facebook/ads/intelligence'

const A = '__ads_intel_a__'
const B = '__ads_intel_b__'
let agencyA = 0
let agencyB = 0
let userA = 0
let userA2 = 0
let userB = 0
const leads: Record<string, number> = {}

async function syncSequence(seqName: string, table: string) {
  await db.raw(`SELECT setval(?, (SELECT COALESCE(MAX(id) + 1, 1) FROM ??), false)`, [seqName, table])
}

async function addLead(
  key: string,
  agencyId: number,
  userId: number,
  status: string,
  attribution: Record<string, unknown> | null,
) {
  const [row] = await db('clients')
    .insert({
      firstName: key,
      lastName: '',
      createdById: userId,
      agencyId,
      userId,
      status,
      lead: true,
      leadSource: `facebook:${key}`,
    })
    .returning('id')
  leads[key] = Number(row.id)
  if (attribution) await db('lead_attribution').insert({ agencyId, leadId: leads[key], provider: 'meta', ...attribution })
}

async function purge() {
  const ids = [agencyA, agencyB].filter(Boolean)
  await db('meta_ads_snapshots').whereIn('agencyId', ids).del()
  await db('lead_attribution').whereIn('agencyId', ids).del()
  await db('clients').whereIn('agencyId', ids).del()
  await db('facebook_ad_connections').whereIn('agencyId', ids).del()
}

beforeAll(async () => {
  await syncSequence('agencies_id_seq', 'agencies')
  await syncSequence('users_seq', 'users')
  await syncSequence('"Client_id_seq"', 'clients')
  const [a] = await db('agencies').insert({ name: A }).returning('id')
  const [b] = await db('agencies').insert({ name: B }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  const [ua] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId: agencyA }).returning('id')
  const [ua2] = await db('users').insert({ firstName: 'A2', role: 'ADMIN', agencyId: agencyA }).returning('id')
  const [ub] = await db('users').insert({ firstName: 'B', role: 'ADMIN', agencyId: agencyB }).returning('id')
  userA = Number(ua.id)
  userA2 = Number(ua2.id)
  userB = Number(ub.id)
})

beforeEach(async () => {
  await purge()
  // Agency A: three leads of campaign C1 on 2026-10-05 Jerusalem time, one on the 4th.
  await addLead('a_new', agencyA, userA, 'new', {
    campaignId: 'C1',
    campaignName: 'קמפיין א',
    adsetId: 'S1',
    adId: 'AD1',
    externalCreatedAt: '2026-10-05T08:00:00Z',
  })
  await addLead('a_contacted', agencyA, userA, 'contacted', {
    campaignId: 'C1',
    campaignName: 'קמפיין א',
    adsetId: 'S1',
    adId: 'AD1',
    externalCreatedAt: '2026-10-05T12:00:00Z',
  })
  // 22:30 UTC on the 4th is 01:30 on the 5th in Jerusalem — it belongs to the 5th.
  await addLead('a_late', agencyA, userA, 'closed', {
    campaignId: 'C1',
    campaignName: 'קמפיין א',
    adsetId: 'S2',
    adId: 'AD2',
    externalCreatedAt: '2026-10-04T22:30:00Z',
  })
  await addLead('a_prev_day', agencyA, userA, 'new', {
    campaignId: 'C1',
    campaignName: 'קמפיין א',
    externalCreatedAt: '2026-10-04T08:00:00Z',
  })
  await addLead('a_no_attr', agencyA, userA, 'new', null)
  // Agency B: same campaign id (ids are Meta's, not ours) — must never mix.
  await addLead('b_lead', agencyB, userB, 'new', {
    campaignId: 'C1',
    campaignName: 'סוד של B',
    adId: 'AD1',
    externalCreatedAt: '2026-10-05T09:00:00Z',
  })
})

afterAll(async () => {
  await purge()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
})

const DAY = { since: '2026-10-05', until: '2026-10-05' }

describe('attributed leads — tenant isolation and period', () => {
  it("returns only the agency's own attributed leads, bucketed by the account's day", async () => {
    const rows = await listAttributedLeads(agencyA, DAY, 'Asia/Jerusalem')
    expect(rows.map((r) => r.leadId).sort()).toEqual([leads.a_new, leads.a_contacted, leads.a_late].sort())
    const c1 = groupOutcomes(rows, 'campaign', new Date('2026-10-06T00:00:00Z')).get('C1')!
    expect(c1).toMatchObject({ name: 'קמפיין א', outcome: { captured: 3, untouched: 1, contacted: 1, closed: 1 } })
  })

  it('the same calendar day in UTC is a different set — the timezone is honoured', async () => {
    const rows = await listAttributedLeads(agencyA, DAY, 'UTC')
    expect(rows.map((r) => r.leadId).sort()).toEqual([leads.a_new, leads.a_contacted].sort())
  })

  it('agency B never sees agency A, even with the same Meta campaign id', async () => {
    const rows = await listAttributedLeads(agencyB, DAY, 'Asia/Jerusalem')
    expect(rows.map((r) => r.leadId)).toEqual([leads.b_lead])
  })

  it("a forged attribution row pointing at another agency's lead contributes nothing", async () => {
    await db('lead_attribution').where({ leadId: leads.b_lead }).del()
    // Attribution claims agency A, but the lead belongs to agency B.
    await db('lead_attribution').insert({
      agencyId: agencyA,
      leadId: leads.b_lead,
      provider: 'meta',
      campaignId: 'C1',
      externalCreatedAt: '2026-10-05T09:00:00Z',
    })
    const rows = await listAttributedLeads(agencyA, DAY, 'Asia/Jerusalem')
    expect(rows.map((r) => r.leadId)).not.toContain(leads.b_lead)
  })

  it('narrows to a campaign / ad set inside the agency', async () => {
    expect(
      (await listAttributedLeads(agencyA, DAY, 'Asia/Jerusalem', { campaignId: 'C1', adsetId: 'S2' })).map((r) => r.leadId),
    ).toEqual([leads.a_late])
  })

  it('an invalid timezone falls back safely instead of failing', async () => {
    expect(await listAttributedLeads(agencyA, DAY, 'Not/AZone')).toHaveLength(3)
  })

  it('the SocialCRM-only view groups by campaign from the same data', async () => {
    const groups = await loadCrmOnlyCampaigns(agencyA, { since: '2026-10-04', until: '2026-10-05' })
    expect(groups).toHaveLength(1)
    expect(groups[0].outcome.captured).toBe(4)
  })

  it('the lead page reads attribution only within the session agency', async () => {
    expect(await getLeadAdAttribution(agencyA, leads.a_new)).toMatchObject({ campaignName: 'קמפיין א', adId: 'AD1' })
    expect(await getLeadAdAttribution(agencyB, leads.a_new)).toBeNull()
    expect(await getLeadAdAttribution(agencyA, leads.a_no_attr)).toBeNull()
  })
})

describe('remembered ad account', () => {
  it("is stored on this user's own connection only, and kept across a reconnect", async () => {
    for (const userId of [userA, userA2]) {
      await saveAdConnection({
        agencyId: agencyA,
        userId,
        accessToken: `tok-${userId}`,
        grantedScopes: ['ads_read'],
        expiresInSeconds: null,
      })
    }
    await setSelectedAdAccount(agencyA, userA, 'act_123')
    expect((await getAdConnection(agencyA, userA))?.selectedAccountId).toBe('act_123')
    expect((await getAdConnection(agencyA, userA2))?.selectedAccountId).toBeNull()

    await saveAdConnection({
      agencyId: agencyA,
      userId: userA,
      accessToken: 'tok-new',
      grantedScopes: ['ads_read'],
      expiresInSeconds: null,
    })
    expect((await getAdConnection(agencyA, userA))?.selectedAccountId).toBe('act_123')
  })

  it('refuses anything that is not an ad account id', async () => {
    await saveAdConnection({
      agencyId: agencyA,
      userId: userA,
      accessToken: 'tok',
      grantedScopes: ['ads_read'],
      expiresInSeconds: null,
    })
    await setSelectedAdAccount(agencyA, userA, "act_1' OR 1=1")
    expect((await getAdConnection(agencyA, userA))?.selectedAccountId).toBeNull()
  })
})

describe('snapshot cache', () => {
  it('is scoped to the agency: the same account and key in another agency is a different row', async () => {
    await writeSnapshot({ agencyId: agencyA, accountId: 'act_1', kind: 'report' }, 'k', { spend: 1 })
    await writeSnapshot({ agencyId: agencyA, accountId: 'act_1', kind: 'report' }, 'k', { spend: 2 })
    expect(
      (await readSnapshot<{ spend: number }>({ agencyId: agencyA, accountId: 'act_1', kind: 'report' }, 'k'))?.payload,
    ).toEqual({ spend: 2 })
    expect(await readSnapshot({ agencyId: agencyB, accountId: 'act_1', kind: 'report' }, 'k')).toBeNull()
    expect(await db('meta_ads_snapshots').where({ agencyId: agencyA }).count({ n: '*' }).first()).toMatchObject({ n: '1' })
  })

  it("a creative on the lead page comes only from the session agency's cache", async () => {
    await writeSnapshot({ agencyId: agencyA, accountId: 'act_1', kind: 'creative' }, '555', {
      imageUrl: 'https://cdn/a.jpg',
      isVideo: false,
    })
    expect((await readCreativeForAd(agencyA, '555'))?.payload).toEqual({ imageUrl: 'https://cdn/a.jpg', isVideo: false })
    expect(await readCreativeForAd(agencyB, '555')).toBeNull()
  })

  it('never stores a token', async () => {
    await writeSnapshot({ agencyId: agencyA, accountId: 'act_1', kind: 'account' }, 'meta', { id: 'act_1', name: 'Main' })
    const row = await db('meta_ads_snapshots').where({ agencyId: agencyA, kind: 'account' }).first()
    expect(JSON.stringify(row.payload)).not.toMatch(/token/i)
  })
})
