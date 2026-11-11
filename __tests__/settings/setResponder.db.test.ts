import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '@/config/db'

/**
 * The מענה אוטומטי response-method switch (AI agent / questionnaire) against a
 * real database: what it writes, what it must never touch, eligibility,
 * compare-and-set, concurrency, tenancy, and that the worker's routing reads
 * back the same choice. Authentication is the only thing faked.
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

import { setAutoResponseResponder } from '@/actions/autoResponse/setResponder'
import { getChannelSettings } from '@/db/autoResponseSettings'
import { QUESTIONNAIRE_ROUTED_SQL } from '@/db/questionnaireJobs'
import AutoResponseSettingsPage from '@/app/(he)/(app)/settings/(admin_settings)/auto-response/page'

const PP = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))
const PROFILE = { greeting: 'היי, כאן הסטודיו', persona: 'נעים', tone: 'friendly', faq: [{ q: 'חניה?', a: 'יש חניה' }], escalationTopics: ['החזר'], importantInfo: '' }

type Tenant = { agencyId: number; adminId: number; agentId: number }
const agencies: number[] = []

async function makeAgency(
  name: string,
  s: { responder: 'agent' | 'questionnaire'; mode: 'qualify' | 'acknowledge'; replyMode?: 'ai' | 'fixed'; questionnaire?: unknown | null },
): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `rs-${name}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [admin] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId }).returning('id')
  const [agent] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: s.mode,
    replyMode: s.replyMode ?? 'ai',
    fixedBody: s.replyMode === 'fixed' ? 'תודה, נחזור אליך' : null,
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
/** Everything except the one column the switch may write (and its audit stamps). */
const untouched = async (t: Tenant) => {
  const { responder: _r, updatedAt: _u, updatedBy: _b, ...rest } = await row(t)
  return JSON.stringify({
    rest,
    revisions: await db('questionnaire_revisions').where({ agencyId: t.agencyId }).orderBy('id'),
    sessions: await db('questionnaire_sessions').where({ agencyId: t.agencyId }).orderBy('id'),
    master: await db('agencies').where({ id: t.agencyId }).first('autoResponseEnabled'),
  })
}

async function addRevisions(t: Tenant) {
  await db('questionnaire_revisions').insert([
    { agencyId: t.agencyId, status: 'published', revision: 1, definition: JSON.stringify(PP), source: 'staff', publishedAt: db.fn.now() },
    { agencyId: t.agencyId, status: 'published', revision: 2, definition: JSON.stringify(PP), source: 'builder', publishedAt: db.fn.now() },
    { agencyId: t.agencyId, status: 'draft', definition: JSON.stringify({ ...PP, opening: 'טיוטה' }), source: 'builder' },
  ])
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('WA_QUESTIONNAIRE_ENABLED', '1')
  vi.stubEnv('WA_QUESTIONNAIRE_AGENCY_IDS', 'all')
  vi.stubEnv('QUESTIONNAIRE_BUILDER_AGENCY_IDS', 'all')
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

describe('switching writes the responder and nothing else', () => {
  it('questionnaire → AI agent keeps the questionnaire, its published revisions and the draft', async () => {
    const t = await makeAgency('q2a', { responder: 'questionnaire', mode: 'qualify', questionnaire: PP })
    await addRevisions(t)
    const before = await untouched(t)
    as(t)
    expect(await setAutoResponseResponder({ to: 'agent', from: 'questionnaire' })).toEqual({ ok: true, responder: 'agent' })
    expect(await row(t)).toMatchObject({ responder: 'agent', updatedBy: t.adminId })
    expect(await untouched(t)).toBe(before)
    expect((await getChannelSettings(t.agencyId, 'whatsapp'))?.responder).toBe('agent')
  })

  it('AI agent → questionnaire keeps the agent profile, description, instructions, mode and reply style', async () => {
    const t = await makeAgency('a2q', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    await addRevisions(t)
    const before = await untouched(t)
    as(t)
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: true, responder: 'questionnaire' })
    expect(await untouched(t)).toBe(before)
    const r = await row(t)
    expect(r).toMatchObject({ responder: 'questionnaire', mode: 'qualify', replyMode: 'ai', guidance: 'סטודיו לצילום חתונות', agentInstructions: 'קצר ולעניין' })
    expect(r.agentProfile).toEqual(PROFILE)
  })

  it('round trip returns the row to exactly where it started', async () => {
    const t = await makeAgency('round', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    const before = await untouched(t)
    as(t)
    await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })
    await setAutoResponseResponder({ to: 'agent', from: 'questionnaire' })
    expect((await row(t)).responder).toBe('agent')
    expect(await untouched(t)).toBe(before)
  })
})

describe('the worker reads back the same choice', () => {
  // The questionnaire worker's own claim predicate, evaluated for a job of this
  // agency that was enqueued as an ordinary agent turn.
  const routedToQuestionnaire = async (t: Tenant) => {
    const r = await db.raw(
      `SELECT ${QUESTIONNAIRE_ROUTED_SQL} AS routed
         FROM (VALUES (?::int, 'whatsapp'::text, 0, 'qualify_turn'::text)) AS j("agencyId", channel, "conversationId", reason)`,
      [t.agencyId],
    )
    return r.rows[0].routed as boolean
  }

  it('after each switch, the next job goes to the worker that was chosen', async () => {
    const t = await makeAgency('route', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    expect(await routedToQuestionnaire(t)).toBe(false)
    await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })
    expect(await routedToQuestionnaire(t)).toBe(true)
    await setAutoResponseResponder({ to: 'agent', from: 'questionnaire' })
    expect(await routedToQuestionnaire(t)).toBe(false)
  })
})

describe('eligibility is enforced on the server, not only on the screen', () => {
  it('no published questionnaire → the questionnaire cannot be chosen', async () => {
    const t = await makeAgency('nopub', { responder: 'agent', mode: 'qualify', questionnaire: null })
    await db('questionnaire_revisions').insert({ agencyId: t.agencyId, status: 'draft', definition: JSON.stringify(PP), source: 'builder' })
    as(t)
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: false, reason: 'unavailable' })
    expect((await row(t)).responder).toBe('agent')
  })

  it('a stored questionnaire that does not validate counts as not published', async () => {
    const t = await makeAgency('invalid', { responder: 'agent', mode: 'qualify', questionnaire: { opening: 'x' } })
    as(t)
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('questionnaire rollout off for the agency → unavailable', async () => {
    vi.stubEnv('WA_QUESTIONNAIRE_AGENCY_IDS', '')
    const t = await makeAgency('qoff', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: false, reason: 'unavailable' })
  })

  it.each([
    ['one AI reply', 'ai'],
    ['one fixed message', 'fixed'],
  ] as const)('acknowledge mode (%s) → the AI agent cannot be chosen, and nothing changes', async (_label, replyMode) => {
    const t = await makeAgency(`ack-${replyMode}`, { responder: 'questionnaire', mode: 'acknowledge', replyMode, questionnaire: PP })
    const before = JSON.stringify(await row(t))
    as(t)
    expect(await setAutoResponseResponder({ to: 'agent', from: 'questionnaire' })).toEqual({ ok: false, reason: 'unavailable' })
    expect(JSON.stringify(await row(t))).toBe(before)
  })

  it('a non-admin cannot switch', async () => {
    const t = await makeAgency('agnt', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t, 'AGNT')
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: false, reason: 'forbidden' })
    expect((await row(t)).responder).toBe('agent')
  })

  it.each([
    [{ to: 'agent', from: 'agent' }],
    [{ to: 'acknowledge', from: 'agent' }],
    [{ to: 'questionnaire', from: 'nope' }],
  ])('malformed input %j is refused', async (input) => {
    const t = await makeAgency('bad', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    expect(await setAutoResponseResponder(input as never)).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('compare-and-set and concurrency', () => {
  it('a stale page (from no longer matches) gets a conflict, never an overwrite', async () => {
    const t = await makeAgency('stale', { responder: 'questionnaire', mode: 'qualify', questionnaire: PP })
    as(t)
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: false, reason: 'conflict' })
    expect((await row(t)).responder).toBe('questionnaire')
  })

  it('two simultaneous switches: exactly one succeeds, the other is a conflict', async () => {
    const t = await makeAgency('race', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    const results = await Promise.all([
      setAutoResponseResponder({ to: 'questionnaire', from: 'agent' }),
      setAutoResponseResponder({ to: 'questionnaire', from: 'agent' }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'conflict' }])
    expect((await row(t)).responder).toBe('questionnaire')
  })
})

describe('tenancy', () => {
  it("switching one agency never changes another's configuration", async () => {
    const mine = await makeAgency('mine', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    const other = await makeAgency('other', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    const otherBefore = JSON.stringify(await row(other))
    as(mine)
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toMatchObject({ ok: true })
    expect(JSON.stringify(await row(other))).toBe(otherBefore)
  })

  it('an agency with no settings row gets no_settings and no row is created', async () => {
    const [a] = await db('agencies').insert({ name: 'rs-norow', plan: 'pro' }).returning('id')
    agencies.push(Number(a.id))
    const [u] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId: a.id }).returning('id')
    auth.user = { id: Number(u.id), agencyId: Number(a.id), role: 'ADMIN' }
    expect(await setAutoResponseResponder({ to: 'questionnaire', from: 'agent' })).toEqual({ ok: false, reason: 'no_settings' })
    expect(await db('auto_response_settings').where({ agencyId: a.id }).first()).toBeUndefined()
  })
})

describe('the settings page renders the persisted choice', () => {
  const page = async () => renderToStaticMarkup(await AutoResponseSettingsPage())

  it('questionnaire stored → questionnaire card pressed, agent settings hidden, edit link shown', async () => {
    const t = await makeAgency('page-q', { responder: 'questionnaire', mode: 'qualify', questionnaire: PP })
    as(t)
    const html = await page()
    expect(html).toMatch(/data-responder-option="questionnaire"[^]*?aria-pressed="true"/)
    expect(html).toMatch(/data-responder-option="agent"[^]*?aria-pressed="false"/)
    expect(html).toContain('data-responder-current="questionnaire"')
    expect(html).toContain('הגדרות הסוכן מוסתרות כי השאלון פעיל')
    expect(html).toContain('href="/settings/questionnaire"')
  })

  it('AI agent stored → agent card pressed and the agent settings shown', async () => {
    const t = await makeAgency('page-a', { responder: 'agent', mode: 'qualify', questionnaire: PP })
    as(t)
    const html = await page()
    expect(html).toMatch(/data-responder-option="agent"[^]*?aria-pressed="true"/)
    expect(html).toContain('data-responder-current="agent"')
    expect(html).not.toContain('הגדרות הסוכן מוסתרות')
  })

  it('no settings row: the page explains the state and creates nothing', async () => {
    const [a] = await db('agencies').insert({ name: 'rs-page-norow', plan: 'pro' }).returning('id')
    agencies.push(Number(a.id))
    const [u] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId: a.id }).returning('id')
    auth.user = { id: Number(u.id), agencyId: Number(a.id), role: 'ADMIN' }
    const html = await page()
    expect(html).toContain('data-responder-current="no_settings"')
    expect(html).toContain('המענה האוטומטי עוד לא הוגדר לעסק')
    expect(html).not.toContain('aria-pressed')
    expect(await db('auto_response_settings').where({ agencyId: a.id }).first()).toBeUndefined()
  })

  it('a one-reply agency: no card selected, the AI agent unavailable with its reason, current behaviour named', async () => {
    const t = await makeAgency('page-ack', { responder: 'agent', mode: 'acknowledge', replyMode: 'fixed', questionnaire: null })
    as(t)
    const html = await page()
    expect(html).not.toContain('aria-pressed="true"')
    expect(html).toContain('data-responder-current="one_fixed_reply"')
    expect(html).toContain('סוכן ה-AI עם שיחה מלאה עדיין לא זמין לעסק שלכם')
    expect(html).toContain('עדיין אין שאלון מפורסם')
  })
})
