/**
 * Lead Ads answers against the real schema: stored once with the lead,
 * idempotent on redelivery, write-once, agency-scoped, deleted with the lead.
 * Driven through `createLeadFromWebhook`, as the webhook and retry worker call it.
 */
import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))
vi.mock('@/lib/system/createSystemTask', () => ({ createSystemTask: vi.fn() }))
vi.mock('@/lib/quota', () => ({
  getQuotaStatus: vi.fn(async () => ({ plan: 'pro', limit: null, used: 0, overQuotaCount: 0 })),
}))
vi.mock('@/lib/analytics/track', () => ({ trackFirstRealLeadOnce: vi.fn(), track: vi.fn(), trackOncePerAgency: vi.fn() }))
vi.mock('@/lib/automations/emit', () => ({ emitAutomationEvent: vi.fn() }))
vi.mock('@/lib/notifications/emitLeadCreated', () => ({ emitLeadCreated: vi.fn() }))

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { formAnswersForLead, recordLeadFormAnswers } from '@/db/leadFormAnswers'
import { normalizeFormAnswers } from '@/lib/facebook/leadFormAnswers'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'
import { REALISTIC_FIELD_DATA } from './leadFormAnswers.test'

let agencyA = 0
let agencyB = 0
let userA = 0
// Random 16-digit ids like Meta's. NOT a timestamp prefix: `clients.idNum` is
// `FB_<id>` truncated to 9 characters by add_zeros_trigger, so ids sharing their
// first 6 digits collide on clients_idNum_agencyId_unique.
const nextLeadId = () => String(1_000_000_000_000_000 + Math.floor(Math.random() * 8_999_999_999_999_999))

async function mkAgency(name: string) {
  const [a] = await db('agencies').insert({ name }).returning('id')
  const agencyId = Number(a.id ?? a)
  const [u] = await db('users')
    .insert({ firstName: 'FA', lastName: 'Test', email: `fa-${agencyId}-${Date.now()}@example.test`, agencyId, role: 'ADMIN' })
    .returning('id')
  return { agencyId, userId: Number(u.id ?? u) }
}

/** Exactly what the webhook does with a Graph lead node. */
async function ingest(fieldData: unknown[], leadgenId = nextLeadId(), agencyId = agencyA, userId = userA) {
  return createLeadFromWebhook({
    ...parseFacebookLead(fieldData as never),
    leadId: leadgenId,
    agencyId,
    userId,
    formAnswers: normalizeFormAnswers(fieldData),
  })
}

beforeAll(async () => {
  ;({ agencyId: agencyA, userId: userA } = await mkAgency('FA Test A'))
  ;({ agencyId: agencyB } = await mkAgency('FA Test B'))
})

afterAll(async () => {
  for (const id of [agencyA, agencyB]) {
    await db('lead_form_answers').where({ agencyId: id }).del()
    await db('lead_attribution').where({ agencyId: id }).del().catch(() => {})
    await db('clients').where({ agencyId: id }).del()
    await db('users').where({ agencyId: id }).del()
    await db('agencies').where({ id }).del()
  }
  await db.destroy()
})

describe('lead_form_answers', () => {
  it('stores every answer with the new lead, in form order', async () => {
    const lead = await ingest(REALISTIC_FIELD_DATA)
    const stored = await formAnswersForLead(agencyA, Number(lead.id))
    expect(stored.map((a) => a.key)).toEqual(REALISTIC_FIELD_DATA.map((f) => f.name))
    expect(stored.find((a) => a.key === 'אילו_שירותים_מעניינים_אותך?')?.values).toEqual(['צילום', 'וידאו'])
    // Name, phone and email extraction is unchanged.
    expect([lead.firstName, lead.lastName, lead.phone, lead.email]).toEqual(['דוד', 'כהן', '972501234567', 'david@example.com'])
  })

  it('a Meta redelivery returns the same lead and leaves one answers row', async () => {
    const leadgenId = nextLeadId()
    const fields = [
      { name: 'full_name', values: ['רותם'] },
      { name: 'phone_number', values: ['0527777777'] },
      { name: 'budget', values: ['first'] },
    ]
    const first = await ingest(fields, leadgenId)
    const again = await ingest([...fields.slice(0, 2), { name: 'budget', values: ['second'] }], leadgenId)
    expect(Number(again.id)).toBe(Number(first.id))
    const rows = await db('lead_form_answers').where({ leadId: first.id })
    expect(rows).toHaveLength(1)
    expect((await formAnswersForLead(agencyA, Number(first.id))).find((a) => a.key === 'budget')?.values).toEqual(['first'])
  })

  it('is write-once: a second write for the same lead is ignored', async () => {
    const lead = await ingest([{ name: 'full_name', values: ['שני כהן'] }, { name: 'q', values: ['original'] }])
    await recordLeadFormAnswers({ agencyId: agencyA, leadId: Number(lead.id), leadgenId: 'x', answers: [{ key: 'q', values: ['overwrite'] }] })
    expect((await formAnswersForLead(agencyA, Number(lead.id))).find((a) => a.key === 'q')?.values).toEqual(['original'])
  })

  it('another agency cannot read them', async () => {
    const lead = await ingest([{ name: 'full_name', values: ['טל'] }, { name: 'secret', values: ['x'] }])
    expect(await formAnswersForLead(agencyB, Number(lead.id))).toEqual([])
  })

  it('a form with no answers stores no row; a lead without a row reads as none', async () => {
    const lead = await createLeadFromWebhook({
      firstName: 'בלי', lastName: 'טופס', phone: '0529999000', email: null,
      leadId: nextLeadId(), agencyId: agencyA, userId: userA, formAnswers: [],
    })
    expect(await db('lead_form_answers').where({ leadId: lead.id })).toHaveLength(0)
    expect(await formAnswersForLead(agencyA, Number(lead.id))).toEqual([])
  })

  it('the answers are deleted with the lead', async () => {
    const lead = await ingest([{ name: 'full_name', values: ['מחיקה'] }, { name: 'q', values: ['a'] }])
    await db('clients').where({ id: lead.id }).del()
    expect(await db('lead_form_answers').where({ leadId: lead.id })).toHaveLength(0)
  })
})
