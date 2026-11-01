import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled: () => flags.agent,
}))

import { db } from '@/config/db'
import {
  hasWaAssistantAudience,
  isWaAssistantAgency,
  isWaAssistantMeetingsAgency,
  waAssistantAudience,
} from '@/lib/flags/waAssistantFlags'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { COPY } from '@/lib/waAssistant/render'
import { checkAgentPlatformReadiness } from '@/lib/whatsapp/platform/agentReadiness'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

/**
 * WA_ASSISTANT_AUDIENCE=all (every agency eligible, no id list) and
 * WA_ASSISTANT_EXCLUDED_AGENCY_IDS. Being in the audience only makes an agency
 * ELIGIBLE: product access, a verified active recipient, the assistant consent,
 * an active user and opt-out are still checked every turn. Unset audience =
 * the explicit-id list, exactly as before. Local test database only.
 */
const VARS = [
  'WA_ASSISTANT_AUDIENCE',
  'WA_ASSISTANT_AGENCY_IDS',
  'WA_ASSISTANT_EXCLUDED_AGENCY_IDS',
  'WA_ASSISTANT_MEETINGS_AGENCY_IDS',
  'WA_ASSISTANT_SENDER_GUIDANCE',
]
const env = (vars: Record<string, string>) => {
  for (const k of VARS) delete process.env[k]
  Object.assign(process.env, vars)
}
const DAY = 24 * 60 * 60 * 1000
let A: number
let B: number
let seq = 0

function harness() {
  const runAgent = vi.fn(async (input: { scope: { agencyId: number } }) => ({
    ok: true as const,
    answer: { headline: `נתוני חשבון ${input.scope.agencyId}`, claims: [], unknown: null },
    evidence: [],
    steps: 1,
    stopReason: 'answered' as const,
    investigationId: 'inv_aud',
    costUsd: 0.001,
  }))
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.AUD_${++seq}` }))
  return {
    runAgent,
    sendText,
    deps: { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never },
  }
}
const ask = (digits: string, body = 'כמה לידים חדשים יש לי?') =>
  processPlatformMessage({
    id: `wamid.__aud_${++seq}`,
    from: digits,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body },
  })
async function drain(deps: object) {
  for (let i = 0; i < 4; i++) if ((await runWaAssistantWorker({}, deps as never)).claimed === 0) break
}
/** An owner who verified the number and gave the assistant consent (v4). */
const owner = async (agencyId: number, digits: string, consent = 'v4') =>
  recipient(agencyId, await user(agencyId), digits, undefined, consent)

describe('the audience flags', () => {
  afterAll(() => env({}))

  it('unset audience: the explicit list exactly as before (`all` inside the list is still ignored)', () => {
    env({ WA_ASSISTANT_AGENCY_IDS: '103,all,*' })
    expect(waAssistantAudience()).toEqual({ mode: 'list', agencyIds: [103], excludedIds: [] })
    expect(isWaAssistantAgency(103)).toBe(true)
    expect(isWaAssistantAgency(104)).toBe(false)
    env({})
    expect(hasWaAssistantAudience()).toBe(false)
    expect(isWaAssistantAgency(103)).toBe(false)
  })

  it('WA_ASSISTANT_AUDIENCE=all: every valid agency id, with an empty list', () => {
    env({ WA_ASSISTANT_AUDIENCE: 'all' })
    expect(hasWaAssistantAudience()).toBe(true)
    for (const id of [1, 103, 999_999]) expect(isWaAssistantAgency(id)).toBe(true)
    for (const id of [0, -1, NaN, 1.5, null, undefined]) expect(isWaAssistantAgency(id as never)).toBe(false)
  })

  it.each(['ALL', 'true', '*', ' al l', 'everyone'])('only exactly `all` opens it: %j does not', (v) => {
    env({ WA_ASSISTANT_AUDIENCE: v })
    expect(isWaAssistantAgency(103)).toBe(false)
  })

  it('exclusions win in both modes; non-digit entries exclude nobody', () => {
    env({ WA_ASSISTANT_AUDIENCE: 'all', WA_ASSISTANT_EXCLUDED_AGENCY_IDS: '158, all, x' })
    expect(isWaAssistantAgency(158)).toBe(false)
    expect(isWaAssistantAgency(159)).toBe(true)
    env({ WA_ASSISTANT_AGENCY_IDS: '103,158', WA_ASSISTANT_EXCLUDED_AGENCY_IDS: '158' })
    expect(isWaAssistantAgency(158)).toBe(false)
    expect(isWaAssistantAgency(103)).toBe(true)
  })

  it('meetings stay an explicit per-agency opt-in under `all`', () => {
    env({ WA_ASSISTANT_AUDIENCE: 'all' })
    expect(isWaAssistantMeetingsAgency(103)).toBe(false)
    env({ WA_ASSISTANT_AUDIENCE: 'all', WA_ASSISTANT_MEETINGS_AGENCY_IDS: '103' })
    expect(isWaAssistantMeetingsAgency(103)).toBe(true)
  })
})

describe('global mode, end to end (WA_ASSISTANT_AUDIENCE=all, no id list)', () => {
  beforeAll(async () => {
    A = await agency('__aud_a__')
    B = await agency('__aud_b__')
  })
  beforeEach(async () => {
    await resetBetweenTests()
    await db('wa_assistant_jobs').del()
    await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
    await db('agencies')
      .whereIn('id', [A, B])
      .update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
    flags.agent = true
    env({ WA_ASSISTANT_AUDIENCE: 'all' })
    process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  })
  afterAll(async () => {
    env({})
    for (const k of ['OWNER_WA_REMINDERS_AUDIENCE', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN'])
      delete process.env[k]
    await db('wa_assistant_jobs').del()
    await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
    await cleanup()
  })

  it('two unlisted agencies are both answered, each only in its own scope, from the shared number', async () => {
    await owner(A, '972500009001')
    await owner(B, '972500009002')
    expect(await Promise.all([ask('972500009001'), ask('972500009002')])).toEqual(['assistant_queued', 'assistant_queued'])
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent.mock.calls.map(([i]) => i.scope.agencyId).sort()).toEqual([A, B].sort())
    const byTo = Object.fromEntries(h.sendText.mock.calls.map(([i]) => [i.toE164, i]))
    expect(byTo['+972500009001'].body).toContain(`חשבון ${A}`)
    expect(byTo['+972500009002'].body).toContain(`חשבון ${B}`)
    for (const s of Object.values(byTo)) expect((s as { phoneNumberId: string }).phoneNumberId).toBe(PLATFORM)
  })

  it('an excluded agency is never queued, and a job queued before the exclusion is refused', async () => {
    await owner(A, '972500009011')
    expect(await ask('972500009011')).toBe('assistant_queued')
    process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS = String(A)
    expect(await ask('972500009011')).toBe('ignored')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(await db('wa_assistant_jobs').first('status', 'refusalReason')).toEqual({
      status: 'refused',
      refusalReason: 'agency_not_enabled',
    })
  })

  it.each([
    ['reminders-only consent (v2)', async () => owner(A, '972500009021', 'v2'), COPY.consentRequired],
    [
      'product access expired',
      async () => {
        await owner(A, '972500009021')
        await db('agencies')
          .where({ id: A })
          .update({ plan: 'free', trialStartedAt: new Date(Date.now() - 10 * DAY), trialEndsAt: new Date(Date.now() - 3 * DAY) })
      },
      COPY.notAvailable,
    ],
    [
      'user suspended',
      async () => {
        const r = await owner(A, '972500009021')
        const row = await db('owner_whatsapp_recipients').where({ id: r }).first('userId')
        await db('users').where({ id: row.userId }).update({ suspended: true })
      },
      null,
    ],
  ])('under `all` the per-turn checks still hold: %s → no Agent run', async (_l, setup, reply) => {
    await setup()
    await ask('972500009021')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText.mock.calls.map(([i]) => i.body)).toEqual(reply ? [reply] : [])
  })

  it('"הסר" still stops everything under `all`', async () => {
    await owner(A, '972500009031')
    expect(await ask('972500009031', 'הסר')).toBe('opted_out')
    expect(await ask('972500009031')).toBe('ignored')
  })

  it('an unverified, unknown sender is never queued under `all`', async () => {
    expect(await ask('972500009041')).toBe('ignored')
    expect(await db('wa_assistant_jobs')).toHaveLength(0)
  })
})

describe('readiness reports the audience mode', () => {
  afterAll(() => env({}))
  const graph = () =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))

  it('`all`: no fake count; mode and number of exclusions only', async () => {
    env({ WA_ASSISTANT_AUDIENCE: 'all', WA_ASSISTANT_EXCLUDED_AGENCY_IDS: '158' })
    const spy = graph()
    const r = await checkAgentPlatformReadiness()
    expect(r).toMatchObject({ assistantAgencies: null, assistantAudience: { mode: 'all', excludedAgencies: 1 } })
    spy.mockRestore()
  })

  it('unset: the listed count, as before', async () => {
    env({ WA_ASSISTANT_AGENCY_IDS: '103,161' })
    const spy = graph()
    expect(await checkAgentPlatformReadiness()).toMatchObject({
      assistantAgencies: 2,
      assistantAudience: { mode: 'list', excludedAgencies: 0 },
    })
    spy.mockRestore()
  })
})
