import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '@/config/db'

/**
 * The response method against a real database, beyond the column table
 * (responseMethodSave.db.test.ts): what a switch must never touch, that the
 * worker routes by the saved choice, server-side eligibility, concurrency,
 * tenancy, and that the page renders the persisted choice. Ported from the
 * removed instant-switch action's suite onto the one save path that remains.
 * Authentication and the business-profile model call are faked.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number; role: string }, mobile: false }))
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess: async () => auth.user,
  requireAgencyUser: async () => auth.user,
}))
vi.mock('@/lib/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/device')>()),
  isMobileWorkspaceRequest: async () => auth.mobile,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/access/productAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/productAccess')>()),
  getAgencyProductAccess: async () => ({ status: 'PAID', hasAccess: true }),
}))
vi.mock('@/lib/inbox/autoresponse/businessProfile', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/inbox/autoresponse/businessProfile')>()
  return {
    ...real,
    deriveBusinessProfile: async ({ description }: { description: string }) => ({
      ok: true,
      profile: {
        version: 1,
        sourceHash: real.hashDescription(description),
        derivedAt: new Date(0).toISOString(),
        facts: [],
        explicit: { prices: [], hours: [], policies: [] },
        objectives: [],
        collect: [],
        tone: null,
        unsupportedRequests: [],
      },
    }),
  }
})

import { updateAutoResponseSettings, type UpdateAutoResponseInput } from '@/actions/autoResponse/updateSettings'
import { QUESTIONNAIRE_ROUTED_SQL } from '@/db/questionnaireJobs'
import AutoResponseSettingsPage from '@/app/(he)/(app)/settings/(admin_settings)/auto-response/page'

const PP = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))
const PROFILE = { greeting: 'היי, כאן הסטודיו', persona: 'נעים', tone: 'friendly', faq: [{ question: 'חניה?', answer: 'יש חניה' }], escalationTopics: ['החזר'] }

type Tenant = { agencyId: number; adminId: number; agentId: number }
const agencies: number[] = []

async function makeAgency(
  name: string,
  s: { responder: 'agent' | 'questionnaire'; mode: 'qualify' | 'acknowledge'; replyMode?: 'ai' | 'fixed'; questionnaire?: unknown | null },
): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `rmp-${name}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [admin] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId }).returning('id')
  const [agent] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    dailyCap: 200,
    mode: s.mode,
    replyMode: s.replyMode ?? 'ai',
    fixedBody: 'תודה, נחזור אליך',
    guidance: 'סטודיו לצילום חתונות',
    agentInstructions: 'קצר ולעניין',
    responder: s.responder,
    questionnaire: s.questionnaire == null ? null : JSON.stringify(s.questionnaire),
    agentProfile: JSON.stringify(PROFILE),
  })
  return { agencyId, adminId: Number(admin.id), agentId: Number(agent.id) }
}

const as = (t: Tenant, role: 'ADMIN' | 'AGNT' = 'ADMIN') => {
  auth.user = { id: role === 'ADMIN' ? t.adminId : t.agentId, agencyId: t.agencyId, role }
}
const row = (t: Tenant) => db('auto_response_settings').where({ agencyId: t.agencyId, channel: 'whatsapp' }).first()

/** The form's save, unchanged settings, only the method moving. */
const save = (over: Partial<UpdateAutoResponseInput>) =>
  updateAutoResponseSettings({
    masterEnabled: true,
    channelEnabled: true,
    dailyCap: 200,
    guidance: 'סטודיו לצילום חתונות',
    agentInstructions: 'קצר ולעניין',
    businessName: null,
    replyMode: 'ai',
    fixedBody: 'תודה, נחזור אליך',
    delaySeconds: 0,
    ...over,
  })

async function addRevisions(t: Tenant) {
  await db('questionnaire_revisions').insert([
    { agencyId: t.agencyId, status: 'published', revision: 1, definition: JSON.stringify(PP), source: 'staff', publishedAt: db.fn.now() },
    { agencyId: t.agencyId, status: 'draft', definition: JSON.stringify({ ...PP, opening: 'טיוטה' }), source: 'builder' },
  ])
}
const revisions = (t: Tenant) => db('questionnaire_revisions').where({ agencyId: t.agencyId }).orderBy('id')

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('WA_QUESTIONNAIRE_ENABLED', '1')
  vi.stubEnv('WA_QUESTIONNAIRE_AGENCY_IDS', 'all')
  vi.stubEnv('QUESTIONNAIRE_BUILDER_AGENCY_IDS', 'all')
  vi.stubEnv('SMART_REPLY_AGENT_ENABLED', '')
  auth.mobile = false
})

afterAll(async () => {
  if (agencies.length) {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
      await trx('questionnaire_revisions').whereIn('agencyId', agencies).del()
    })
    await db('auto_response_settings').whereIn('agencyId', agencies).del()
    await db('users').whereIn('agencyId', agencies).del()
    await db('agencies').whereIn('id', agencies).del()
  }
  await db.destroy()
})

describe('a switch keeps what belongs to the other method', () => {
  it('questionnaire → AI keeps the questionnaire, its published revisions and the draft', async () => {
    const t = await makeAgency('q2a', { responder: 'questionnaire', mode: 'qualify', questionnaire: PP })
    await addRevisions(t)
    const before = { questionnaire: (await row(t)).questionnaire, revisions: await revisions(t) }
    as(t)
    expect(await save({ method: 'ai', methodFrom: 'questionnaire' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'agent', questionnaire: before.questionnaire })
    expect(await revisions(t)).toEqual(before.revisions)
  })

  it('AI → questionnaire keeps the agent profile, description, instructions, mode and reply style', async () => {
    const t = await makeAgency('a2q', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toMatchObject({ ok: true })
    const r = await row(t)
    expect(r).toMatchObject({ responder: 'questionnaire', mode: 'qualify', replyMode: 'ai', guidance: 'סטודיו לצילום חתונות', agentInstructions: 'קצר ולעניין' })
    expect(r.agentProfile).toMatchObject({ greeting: PROFILE.greeting, faq: PROFILE.faq })
  })
})

describe('the worker reads back the saved choice', () => {
  // The questionnaire worker's own claim predicate, for a job of this agency enqueued as an ordinary agent turn.
  const routedToQuestionnaire = async (t: Tenant) => {
    const r = await db.raw(
      `SELECT ${QUESTIONNAIRE_ROUTED_SQL} AS routed
         FROM (VALUES (?::int, 'whatsapp'::text, 0, 'qualify_turn'::text)) AS j("agencyId", channel, "conversationId", reason)`,
      [t.agencyId],
    )
    return r.rows[0].routed as boolean
  }

  it('after each save, the next job goes to the worker that was chosen', async () => {
    const t = await makeAgency('route', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    expect(await routedToQuestionnaire(t)).toBe(false)
    await save({ method: 'questionnaire', methodFrom: 'ai' })
    expect(await routedToQuestionnaire(t)).toBe(true)
    await save({ method: 'fixed', methodFrom: 'questionnaire' })
    expect(await routedToQuestionnaire(t)).toBe(false)
  })
})

describe('eligibility and authority are enforced on the server', () => {
  it('a stored questionnaire that does not validate counts as not published', async () => {
    const t = await makeAgency('invalid', { responder: 'agent', mode: 'qualify', questionnaire: { opening: 'x' } })
    as(t)
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toEqual({ ok: false, reason: 'method_unavailable' })
    expect((await row(t)).responder).toBe('agent')
  })

  it('a non-admin cannot save', async () => {
    const t = await makeAgency('agnt', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t, 'AGNT')
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toEqual({ ok: false, reason: 'forbidden' })
    expect((await row(t)).responder).toBe('agent')
  })
})

describe('concurrency and tenancy', () => {
  it('two simultaneous saves from the same page: exactly one succeeds, the other is a conflict', async () => {
    const t = await makeAgency('race', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    const results = await Promise.all([save({ method: 'questionnaire', methodFrom: 'ai' }), save({ method: 'fixed', methodFrom: 'ai' })])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'method_conflict' }])
  })

  it("saving one agency never changes another's configuration", async () => {
    const mine = await makeAgency('mine', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    const other = await makeAgency('other', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    const otherBefore = JSON.stringify(await row(other))
    as(mine)
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toMatchObject({ ok: true })
    expect(JSON.stringify(await row(other))).toBe(otherBefore)
  })
})

describe('the settings page renders the persisted choice', () => {
  const page = async () => renderToStaticMarkup(await AutoResponseSettingsPage())

  it('questionnaire stored → questionnaire card pressed, agent settings hidden, edit link shown', async () => {
    const t = await makeAgency('page-q', { responder: 'questionnaire', mode: 'qualify', questionnaire: PP })
    as(t)
    const html = await page()
    expect(html).toMatch(/data-responder-option="questionnaire"[^]*?aria-pressed="true"/)
    expect(html).toMatch(/data-responder-option="ai"[^]*?aria-pressed="false"/)
    // The 3-way selector: the active card's badge names what answers; no "פעיל כעת" line.
    expect(html).toMatch(/data-responder-option="questionnaire"[^]*?פעיל/)
    expect(html).toContain('הגדרות הסוכן מוסתרות כי השאלון פעיל')
    expect(html).toContain('href="/settings/questionnaire"')
  })

  it('AI agent stored → agent card pressed and the agent settings shown', async () => {
    const t = await makeAgency('page-a', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    const html = await page()
    expect(html).toMatch(/data-responder-option="ai"[^]*?aria-pressed="true"/)
    expect(html).toContain('סוכן AI חכם')
    expect(html).not.toContain('הגדרות הסוכן מוסתרות')
  })

  it('no settings row: the page explains the state and creates nothing', async () => {
    const [a] = await db('agencies').insert({ name: 'rmp-page-norow', plan: 'pro' }).returning('id')
    agencies.push(Number(a.id))
    const [u] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId: a.id }).returning('id')
    auth.user = { id: Number(u.id), agencyId: Number(a.id), role: 'ADMIN' }
    const html = await page()
    expect(html).toContain('data-responder-current="no_settings"')
    expect(html).toContain('המענה האוטומטי עוד לא הוגדר לעסק')
    expect(html).not.toContain('aria-pressed')
    expect(await db('auto_response_settings').where({ agencyId: a.id }).first()).toBeUndefined()
  })

  it('a one-reply agency: the fixed message is the active method; the AI card says it is one AI reply, with its reason', async () => {
    const t = await makeAgency('page-ack', { responder: 'agent', mode: 'acknowledge', replyMode: 'fixed', questionnaire: null })
    as(t)
    const html = await page()
    expect(html).toMatch(/data-responder-option="fixed"[^]*?aria-pressed="true"/)
    expect(html).toMatch(/data-responder-option="ai"[^]*?תשובת AI אחת/)
    expect(html).not.toContain('סוכן AI חכם')
    expect(html).toContain('סוכן ה-AI עם שיחה מלאה עדיין לא זמין לעסק שלכם')
    expect(html).toContain('עדיין אין שאלון מפורסם')
  })
})
