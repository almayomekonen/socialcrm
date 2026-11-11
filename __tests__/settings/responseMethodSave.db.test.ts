import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'

/**
 * The 3-way response method (AI / questionnaire / fixed message) saved through
 * the settings form's ONE action, against a real database: which columns each
 * method writes, that the agent's settings survive a round trip through the
 * questionnaire, eligibility, the stale-write refusal, and that a refusal writes
 * nothing. Authentication and the business-profile model call are faked.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number; role: string } }))
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess: async () => auth.user,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
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

const PP = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))

type Tenant = { agencyId: number; adminId: number }
const agencies: number[] = []

async function makeAgency(
  name: string,
  s: { responder: 'agent' | 'questionnaire'; mode: 'qualify' | 'acknowledge'; replyMode: 'ai' | 'fixed'; questionnaire?: unknown | null },
): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `rm-${name}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [admin] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId }).returning('id')
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    dailyCap: 200,
    mode: s.mode,
    replyMode: s.replyMode,
    fixedBody: 'תודה, נחזור אליך',
    guidance: 'סטודיו לצילום חתונות',
    agentInstructions: 'קצר ולעניין',
    responder: s.responder,
    questionnaire: s.questionnaire == null ? null : JSON.stringify(s.questionnaire),
  })
  auth.user = { id: Number(admin.id), agencyId, role: 'ADMIN' }
  return { agencyId, adminId: Number(admin.id) }
}

const row = (t: Tenant) => db('auto_response_settings').where({ agencyId: t.agencyId, channel: 'whatsapp' }).first()

/** The form's save, as the page sends it. */
function save(over: Partial<UpdateAutoResponseInput>): Promise<Awaited<ReturnType<typeof updateAutoResponseSettings>>> {
  return updateAutoResponseSettings({
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
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('WA_QUESTIONNAIRE_ENABLED', '1')
  vi.stubEnv('WA_QUESTIONNAIRE_AGENCY_IDS', 'all')
  vi.stubEnv('SMART_REPLY_AGENT_ENABLED', '')
  vi.stubEnv('SMART_REPLY_AGENT_AGENCY_IDS', '')
})

afterAll(async () => {
  if (agencies.length) {
    await db('auto_response_settings').whereIn('agencyId', agencies).del()
    await db('users').whereIn('agencyId', agencies).del()
    await db('agencies').whereIn('id', agencies).del()
  }
  await db.destroy()
})

describe('each method writes responder, replyMode and mode together', () => {
  it("questionnaire → fixed when mode was 'acknowledge' (the case the old switch refused)", async () => {
    const t = await makeAgency('q2f-ack', { responder: 'questionnaire', mode: 'acknowledge', replyMode: 'ai', questionnaire: PP })
    expect(await save({ method: 'fixed', methodFrom: 'questionnaire' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'agent', replyMode: 'fixed', mode: 'acknowledge', fixedBody: 'תודה, נחזור אליך' })
  })

  it('questionnaire → fixed when mode was qualify', async () => {
    const t = await makeAgency('q2f-q', { responder: 'questionnaire', mode: 'qualify', replyMode: 'ai', questionnaire: PP })
    expect(await save({ method: 'fixed', methodFrom: 'questionnaire' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'agent', replyMode: 'fixed', mode: 'acknowledge' })
  })

  it('AI → questionnaire leaves the agent settings exactly as they were', async () => {
    const t = await makeAgency('a2q', { responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaire: PP })
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({
      responder: 'questionnaire',
      mode: 'qualify',
      replyMode: 'ai',
      guidance: 'סטודיו לצילום חתונות',
      agentInstructions: 'קצר ולעניין',
    })
  })

  it('fixed → questionnaire → AI returns to the conversational agent for a Smart Reply agency', async () => {
    const t = await makeAgency('f2q2a', { responder: 'agent', mode: 'acknowledge', replyMode: 'fixed', questionnaire: PP })
    vi.stubEnv('SMART_REPLY_AGENT_ENABLED', '1')
    vi.stubEnv('SMART_REPLY_AGENT_AGENCY_IDS', String(t.agencyId))
    expect(await save({ method: 'questionnaire', methodFrom: 'fixed', replyMode: 'fixed' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'questionnaire', replyMode: 'fixed', mode: 'acknowledge' })
    expect(await save({ method: 'ai', methodFrom: 'questionnaire' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'agent', replyMode: 'ai', mode: 'qualify' })
  })

  it('outside the Smart Reply rollout, AI from fixed is one AI reply: mode stays acknowledge', async () => {
    const t = await makeAgency('f2a-ack', { responder: 'agent', mode: 'acknowledge', replyMode: 'fixed' })
    expect(await save({ method: 'ai', methodFrom: 'fixed' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'agent', replyMode: 'ai', mode: 'acknowledge' })
  })
})

describe('refusals write nothing', () => {
  it('stale write: the page showed AI but the row is now the questionnaire', async () => {
    const t = await makeAgency('stale', { responder: 'questionnaire', mode: 'qualify', replyMode: 'ai', questionnaire: PP })
    const before = await row(t)
    expect(await save({ method: 'fixed', methodFrom: 'ai', dailyCap: 5, delaySeconds: 30 })).toEqual({ ok: false, reason: 'method_conflict' })
    const after = await row(t)
    expect(after).toEqual(before)
  })

  it('stale write: two tabs — the second save from the same starting point is refused', async () => {
    const t = await makeAgency('tabs', { responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaire: PP })
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toMatchObject({ ok: true })
    const before = await row(t)
    expect(await save({ method: 'fixed', methodFrom: 'ai' })).toEqual({ ok: false, reason: 'method_conflict' })
    expect(await row(t)).toEqual(before)
  })

  it('the questionnaire cannot be chosen without a published copy', async () => {
    const t = await makeAgency('unpub', { responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaire: null })
    const before = await row(t)
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toEqual({ ok: false, reason: 'method_unavailable' })
    expect(await row(t)).toEqual(before)
  })

  it('the questionnaire cannot be chosen when it is not enabled for the agency', async () => {
    const t = await makeAgency('noflag', { responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaire: PP })
    vi.stubEnv('WA_QUESTIONNAIRE_AGENCY_IDS', '')
    expect(await save({ method: 'questionnaire', methodFrom: 'ai' })).toEqual({ ok: false, reason: 'method_unavailable' })
    expect((await row(t)).responder).toBe('agent')
  })

  it('an unknown method is invalid', async () => {
    await makeAgency('invalid', { responder: 'agent', mode: 'qualify', replyMode: 'ai' })
    expect(await save({ method: 'agent' as never, methodFrom: 'ai' })).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('without a method the save behaves as before', () => {
  it('the reply style alone decides; responder is not touched', async () => {
    const t = await makeAgency('legacy', { responder: 'questionnaire', mode: 'qualify', replyMode: 'ai', questionnaire: PP })
    expect(await save({ replyMode: 'fixed' })).toMatchObject({ ok: true })
    expect(await row(t)).toMatchObject({ responder: 'questionnaire', replyMode: 'fixed', mode: 'acknowledge' })
  })
})
