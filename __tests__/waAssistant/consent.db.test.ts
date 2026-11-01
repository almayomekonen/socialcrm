import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Consent to conversations with the SocialCRM assistant (v3), against a real
 * (local test) PostgreSQL. Only the session, the Agent and the send are
 * injected; every consent is read back from owner_whatsapp_recipients.
 *
 * The rule: the assistant answers only a row whose CURRENT consent is v3.
 * A reminders-only consent (v2) never counts, withdrawing goes back to v2
 * (reminders stay on), and "הסר" / turning off stops both.
 */
const session = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number } }))
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/db/auth', () => ({ getUser: async () => session.user }))
vi.mock('@/lib/ai/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled: () => flags.agent,
}))
vi.mock('@/lib/requireUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/requireUser')>()
  const requireAgencyUser = async () => {
    if (!session.user) throw new actual.AuthError('no_session')
    return session.user
  }
  return { ...actual, requireAgencyUser, requireProductAccess: requireAgencyUser }
})

import { db } from '@/config/db'
import {
  grantWhatsappAssistantConsent,
  startWhatsappReminderActivation,
  turnOffWhatsappReminders,
  withdrawWhatsappAssistantConsent,
} from '@/actions/whatsappReminders'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { COPY } from '@/lib/waAssistant/render'
import { OWNER_WA_ASSISTANT_CONSENT, OWNER_WA_CONSENT, consentCoversAssistant } from '@/lib/whatsapp/platform/consentText'
import { ownerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let NO_ASSISTANT: number
let seq = 0

const consentOf = async (agencyId: number, userId: number) =>
  (await db('owner_whatsapp_recipients').where({ agencyId, userId }).first('consentTextVersion', 'status')) as {
    consentTextVersion: string
    status: string
  }

function harness() {
  const runAgent = vi.fn(async (input: { scope: { agencyId: number } }) => ({
    ok: true as const,
    answer: { headline: `נתוני חשבון ${input.scope.agencyId}`, claims: [], unknown: null },
    evidence: [],
    steps: 1,
    stopReason: 'answered' as const,
    investigationId: 'inv_consent',
    costUsd: 0.001,
  }))
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.R_${++seq}` }))
  return {
    runAgent,
    sendText,
    deps: { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never },
  }
}
async function ask(digits: string, body = 'כמה לידים חדשים יש לי?') {
  const id = `wamid.__consent_${++seq}`
  const outcome = await processPlatformMessage({
    id,
    from: digits,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body },
  })
  return { id, outcome }
}
async function drain(deps: object) {
  for (let i = 0; i < 4; i++) if ((await runWaAssistantWorker({}, deps as never)).claimed === 0) break
}

beforeAll(async () => {
  A = await agency('__consent_a__')
  B = await agency('__consent_b__')
  NO_ASSISTANT = await agency('__consent_none__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('wa_assistant_jobs').del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('agencies')
    .whereIn('id', [A, B, NO_ASSISTANT])
    .update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  session.user = null
  flags.agent = true
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B}`
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B},${NO_ASSISTANT}`
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
})
afterAll(async () => {
  for (const k of [
    'WA_ASSISTANT_AGENCY_IDS',
    'OWNER_WA_REMINDERS_AGENCY_IDS',
    'PLATFORM_WHATSAPP_PHONE_NUMBER_ID',
    'PLATFORM_WHATSAPP_ACCESS_TOKEN',
    'PLATFORM_WHATSAPP_WA_ME_NUMBER',
  ])
    delete process.env[k]
  await db('wa_assistant_jobs').del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await cleanup()
})

describe('the consent texts', () => {
  it('v2 stays reminders only; only v3 covers the assistant', () => {
    expect(OWNER_WA_CONSENT.version).toBe('v2')
    expect(consentCoversAssistant('v2')).toBe(false)
    expect(consentCoversAssistant(null)).toBe(false)
    expect(consentCoversAssistant('v3')).toBe(true)
  })

  it('v4 (current) states the assistant reads ONLY the connected business, and only what the role permits', () => {
    expect(OWNER_WA_ASSISTANT_CONSENT.version).toBe('v4')
    expect(OWNER_WA_ASSISTANT_CONSENT.text).toContain('רק נתונים של העסק שהמספר הזה מחובר אליו')
    expect(OWNER_WA_ASSISTANT_CONSENT.text).toContain('ורק את מה שמותר לי לראות לפי ההרשאות של התפקיד שלי')
    expect(consentCoversAssistant('v4')).toBe(true)
  })

  it('the current text names the assistant, AI processing, the CRM data read, the private/customer distinction and both ways to stop', () => {
    const t = OWNER_WA_ASSISTANT_CONSENT.text
    for (const part of [
      'העוזר החכם של SocialCRM',
      'בינה מלאכותית',
      'נתונים של העסק',
      'שיחות עם לקוחות',
      'פרטית',
      'לא כותב ללקוחות',
      'לבטל את השיחות עם העוזר',
      '"הסר"',
      'תזכורות',
    ])
      expect(t).toContain(part)
  })
})

describe('consent granted at activation (assistant agency)', () => {
  it('records v3 for the text shown; the owner is then answered', async () => {
    const u = await user(A)
    session.user = { id: u, agencyId: A }
    const res = await startWhatsappReminderActivation({ consent: true, consentVersion: 'v4' })
    if (!('ok' in res)) throw new Error(res.msg)
    expect(
      await processPlatformMessage({
        id: `wamid.__consent_act_${++seq}`,
        from: '972500008001',
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: res.code },
      }),
    ).toBe('activated')
    expect(await consentOf(A, u)).toEqual({ consentTextVersion: 'v4', status: 'active' })

    expect((await ask('972500008001')).outcome).toBe('assistant_queued')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(h.sendText.mock.calls[0][0].body).toContain(`חשבון ${A}`)
  })

  it('a page that showed the reminders-only text cannot record a consent for the assistant agency', async () => {
    const u = await user(A)
    session.user = { id: u, agencyId: A }
    for (const shown of [undefined, 'v2', 'v9']) {
      expect(await startWhatsappReminderActivation({ consent: true, consentVersion: shown })).toEqual({
        fail: true,
        msg: expect.stringContaining('נוסח ההסכמה התעדכן'),
      })
    }
    expect(await consentOf(A, u)).toBeUndefined()
  })

  it('an agency WITHOUT the assistant still records reminders-only v2, exactly as before', async () => {
    const u = await user(NO_ASSISTANT)
    session.user = { id: u, agencyId: NO_ASSISTANT }
    expect('ok' in (await startWhatsappReminderActivation({ consent: true }))).toBe(true)
    expect((await consentOf(NO_ASSISTANT, u)).consentTextVersion).toBe('v2')
  })
})

describe('missing consent: an existing reminders-only (v2) owner', () => {
  it('is NOT treated as consenting: no Agent run; one fixed "approve in settings" reply, no CRM data', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008011') // v2
    expect((await ask('972500008011')).outcome).toBe('assistant_queued')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText.mock.calls.map(([i]) => i.body)).toEqual([COPY.consentRequired])
    expect(await db('wa_assistant_jobs').first('status', 'refusalReason')).toEqual({
      status: 'refused',
      refusalReason: 'consent_required',
    })
  })

  it('the settings view asks for the assistant consent; nothing upgrades it implicitly', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008012')
    const row = await db('owner_whatsapp_recipients').where({ agencyId: A, userId: u }).first()
    expect(ownerReminderView(row, new Date(), { assistantEnabled: true }).assistant).toBe('consent_required')
    expect(ownerReminderView(row, new Date(), { assistantEnabled: false }).assistant).toBe('not_offered')
  })
})

describe('granting the assistant consent on an already verified number', () => {
  it('needs the box ticked and the v3 text; then records v3, keeps the number active, and the owner is answered', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008021')
    session.user = { id: u, agencyId: A }
    expect(await grantWhatsappAssistantConsent({ consent: false, consentVersion: 'v4' })).toMatchObject({ fail: true })
    expect(await grantWhatsappAssistantConsent({ consent: true, consentVersion: 'v2' })).toMatchObject({ fail: true })
    expect((await consentOf(A, u)).consentTextVersion).toBe('v2')

    expect(await grantWhatsappAssistantConsent({ consent: true, consentVersion: 'v4' })).toEqual({ ok: true })
    expect(await consentOf(A, u)).toEqual({ consentTextVersion: 'v4', status: 'active' })
    await ask('972500008021')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
  })

  it('refused for an agency without the assistant, and for a number that is not verified', async () => {
    const u = await user(NO_ASSISTANT)
    await recipient(NO_ASSISTANT, u, '972500008022')
    session.user = { id: u, agencyId: NO_ASSISTANT }
    expect(await grantWhatsappAssistantConsent({ consent: true, consentVersion: 'v4' })).toEqual({
      fail: true,
      msg: 'העוזר אינו זמין לחשבון זה',
    })
    const v = await user(A)
    session.user = { id: v, agencyId: A }
    expect(await grantWhatsappAssistantConsent({ consent: true, consentVersion: 'v4' })).toEqual({
      fail: true,
      msg: 'קודם צריך להפעיל ולאמת את המספר',
    })
  })

  it("acts only on the session's own row, never another user's or tenant's", async () => {
    const mine = await user(A)
    const other = await user(B)
    await recipient(A, mine, '972500008023')
    await recipient(B, other, '972500008024')
    session.user = { id: mine, agencyId: A }
    await grantWhatsappAssistantConsent({ consent: true, consentVersion: 'v4' })
    expect((await consentOf(A, mine)).consentTextVersion).toBe('v4')
    expect((await consentOf(B, other)).consentTextVersion).toBe('v2')
  })
})

describe('the v3 → v4 wording change', () => {
  it('a page that still shows the v3 text can no longer record a consent (activation or grant)', async () => {
    const u = await user(A)
    session.user = { id: u, agencyId: A }
    expect(await startWhatsappReminderActivation({ consent: true, consentVersion: 'v3' })).toMatchObject({ fail: true })
    const v = await user(A)
    await recipient(A, v, '972500008051')
    session.user = { id: v, agencyId: A }
    expect(await grantWhatsappAssistantConsent({ consent: true, consentVersion: 'v3' })).toMatchObject({ fail: true })
    expect((await consentOf(A, v)).consentTextVersion).toBe('v2')
  })

  it('an existing v3 consent is still honoured and is never rewritten to v4', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008052', undefined, 'v3')
    await ask('972500008052')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect((await consentOf(A, u)).consentTextVersion).toBe('v3')
    const row = await db('owner_whatsapp_recipients').where({ agencyId: A, userId: u }).first()
    expect(ownerReminderView(row, new Date(), { assistantEnabled: true }).assistant).toBe('granted')
  })
})

describe('revoking', () => {
  it('withdrawing the assistant returns the row to reminders-only v2, keeps reminders active, and stops answers', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008031', undefined, 'v3')
    session.user = { id: u, agencyId: A }
    expect(await withdrawWhatsappAssistantConsent()).toEqual({ ok: true })
    expect(await consentOf(A, u)).toEqual({ consentTextVersion: 'v2', status: 'active' })
    await ask('972500008031')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('withdrawn AFTER the message was queued: the queued turn is refused too', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008032', undefined, 'v3')
    expect((await ask('972500008032')).outcome).toBe('assistant_queued')
    session.user = { id: u, agencyId: A }
    await withdrawWhatsappAssistantConsent()
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('"הסר" still stops everything (assistant and reminders), with no reply', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008033', undefined, 'v3')
    expect((await ask('972500008033', 'הסר')).outcome).toBe('opted_out')
    expect((await consentOf(A, u)).status).toBe('opted_out')
    expect((await ask('972500008033')).outcome).toBe('ignored')
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('turning off in settings stops everything too', async () => {
    const u = await user(A)
    await recipient(A, u, '972500008034', undefined, 'v3')
    session.user = { id: u, agencyId: A }
    await turnOffWhatsappReminders()
    expect((await consentOf(A, u)).status).toBe('opted_out')
    expect((await ask('972500008034')).outcome).toBe('ignored')
  })
})

describe('tenant isolation with mixed consent', () => {
  it('two tenants on the same number: the consenting one is answered with its own data, the other only gets the consent reply', async () => {
    await recipient(A, await user(A), '972500008041', undefined, 'v3')
    await recipient(B, await user(B), '972500008042') // v2
    await Promise.all([ask('972500008041'), ask('972500008042')])
    const h = harness()
    await drain(h.deps)
    expect(h.runAgent.mock.calls.map(([i]) => i.scope.agencyId)).toEqual([A])
    const byTo = Object.fromEntries(h.sendText.mock.calls.map(([i]) => [i.toE164, i.body]))
    expect(byTo['+972500008041']).toContain(`חשבון ${A}`)
    expect(byTo['+972500008042']).toBe(COPY.consentRequired)
  })
})
