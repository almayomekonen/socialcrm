import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The owner's simulator IS the real conversational agent.
 *
 * Each conversation below is played twice against a real database: once
 * through production (the webhook's ingest, the job queue, the worker with every
 * gate, the send gate) and once through the simulator. The model is the same
 * script in both, and records every call. The test then demands that the two
 * sent the model IDENTICAL arguments (prompt inputs, greeting line,
 * conversational context, business identity, sales move, regeneration reason)
 * and produced identical replies and the same conversation memory. The only
 * fields set aside are execution ones: the abort signal, the trace ids, the
 * simulator's allowlist bypass, and timestamps.
 */

const h = vi.hoisted(() => ({
  simCalls: [] as unknown[],
  simScript: [] as unknown[],
  respond: null as null | ((args: never, script: unknown[]) => Promise<unknown>),
  user: null as null | { id: number; agencyId: number; role: string },
}))
vi.mock('@/lib/inbox/autoresponse/qualify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/autoresponse/qualify')>()
  return {
    ...actual,
    generateQualifyTurn: async (args: never) => {
      h.simCalls.push(args)
      return h.respond!(args, h.simScript)
    },
  }
})
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess: async () => h.user,
}))

import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { getAiState } from '@/db/conversationAiState'
import { getChannelSettings } from '@/db/autoResponseSettings'
import { loadBusinessIdentity } from '@/lib/inbox/autoresponse/businessIdentity'
import { greetingLine as templateGreeting } from '@/lib/inbox/autoresponse/greeting'
import { handoffMessage, type QualifyGenResult } from '@/lib/inbox/autoresponse/qualify'
import { sanitiseSimState, simulateConversationalTurn, type SimState, type SimTurn } from '@/lib/inbox/autoresponse/simulate/simulateTurn'
import { previewConversationalTurn } from '@/lib/inbox/autoresponse/simulate/previewConversational'
import { previewAgentTurn } from '@/actions/autoResponse/previewAgent'

type Ok = Extract<QualifyGenResult, { ok: true }>
type Call = { transcript: Array<{ direction: string; text: string }>; conversational?: unknown; greetingLine?: string | null }
/** One model answer: fixed fields, or a function of the call (so a reply can quote the greeting it was handed). */
type Step = Partial<Ok> | ((call: Call) => Partial<Ok>)

const base = (): Ok => ({
  ok: true,
  reply: 'בשמחה, איך אפשר לעזור?',
  extracted: {},
  corrected: [],
  objective: 'discover_need',
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  salesMove: 'DISCOVERY',
  hotSignal: false,
  uncertain: false,
  model: 'scripted',
})
async function answer(args: Call, script: unknown[]): Promise<QualifyGenResult> {
  const next = script.shift() as Step | undefined
  const value = typeof next === 'function' ? next(args) : next
  return { ...base(), ...(value ?? {}) }
}
h.respond = answer as never

let workerCalls: unknown[] = []
let workerScript: unknown[] = []
let sent: string[] = []
const send = (async (args: { body: string }) => {
  sent.push(args.body)
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never
const generateQualify = (async (args: Call) => {
  workerCalls.push(args)
  return answer(args, workerScript)
}) as never
const drain = () => runAutoResponseWorker({ deps: { send, generate: (async () => ({ ok: true, reply: 'x' })) as never, generateQualify }, workerId: `parity-${Math.random()}` })

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; conversationId: number; phoneNumberId: string; customerWaId: string }

async function makeTenant(suffix: string, opts: { mode?: 'qualify' | 'acknowledge'; responder?: 'agent' | 'questionnaire'; agentProfile?: Record<string, unknown> } = {}): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `מנכל SocialCrm ${suffix}`, autoResponseEnabled: true, plan: 'free', trialExempt: true }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `parity_pn_${suffix}_${agencyId}`
  const customerWaId = `97253${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 't' })
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: opts.mode ?? 'qualify',
    responder: opts.responder ?? 'agent',
    replyMode: 'ai',
    guidance: 'SocialCRM: מערכת CRM ללידים מהרשתות החברתיות. מחיר: 89 ₪ לחודש.',
    agentInstructions: 'בשיחה אישית תענה בטבעיות, כמו חבר.',
    updatedBy: userId,
    ...(opts.agentProfile ? { agentProfile: JSON.stringify(opts.agentProfile) } : {}),
  })
  // No lead: the simulator has none either, so the CRM context is a new contact in both.
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId, customerName: 'דני' })
    .returning('id')
  return { agencyId, userId, conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

const says = (t: Tenant, body: string) =>
  ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: null,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דני',
    rawMessage: { id: `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
  })

/** Execution-only fields set aside; everything the model is told stays. */
function comparable(call: unknown): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) {
        if (['abortSignal', 'trace', 'bypassAllowlist', 'nowMs'].includes(k) || /(At|AtMs)$/.test(k)) continue
        out[k] = strip(val)
      }
      return out
    }
    return v
  }
  return strip(call)
}
const modeOfMemory = (q: unknown) => {
  const c = (q as { conversation?: Record<string, unknown> } | undefined)?.conversation
  return c ? { mode: c.mode, confidence: c.confidence, personalTurns: c.personalTurns, businessTurns: c.businessTurns } : null
}

type Turn = { say: string; model?: Step[] }
type Played = { reply: string; outcome: string; reason: string | null; mode: string | null; greeted: boolean }

/** Plays the conversation through production and through the simulator, turn by turn, and compares them. */
async function playBoth(t: Tenant, turns: Turn[]): Promise<Played[]> {
  let simTranscript: SimTurn[] = []
  let simState: SimState = sanitiseSimState(undefined)
  const played: Played[] = []
  for (const turn of turns) {
    workerCalls = []
    sent = []
    workerScript = [...(turn.model ?? [])]
    await says(t, turn.say)
    await drain()

    h.simCalls = []
    h.simScript = [...(turn.model ?? [])]
    simTranscript = [...simTranscript, { direction: 'inbound', text: turn.say }]
    const settings = (await getChannelSettings(t.agencyId, 'whatsapp'))!
    const identity = await loadBusinessIdentity(t.agencyId, 'whatsapp')
    const r = await simulateConversationalTurn({ agencyId: t.agencyId, settings, identity, transcript: simTranscript, state: simState, nowMs: Date.now() })
    if ('unavailable' in r || 'generationFailed' in r) throw new Error('simulator unavailable')

    // The same model arguments, call for call (including any repair call)…
    expect(h.simCalls.map(comparable), `model calls for "${turn.say}"`).toEqual(workerCalls.map(comparable))
    // …the same message (or the same silence)…
    expect(r.reply ? [r.reply] : [], `reply for "${turn.say}"`).toEqual(sent)
    // …and the same memory of the conversation afterwards.
    expect(modeOfMemory(r.state.qualification)).toEqual(modeOfMemory((await getAiState(t.conversationId))?.qualification))

    simState = r.state
    if (r.reply) simTranscript = [...simTranscript, { direction: 'outbound', text: r.reply }]
    played.push({ reply: r.reply, outcome: r.outcome, reason: r.reason, mode: r.mode, greeted: r.greeted })
  }
  return played
}

const personal = (reply: string): Step => ({ reply, salesMove: 'CASUAL_ACKNOWLEDGEMENT', conversationMode: 'personal', modeConfidence: 'high', personalClaims: false, escalationTopic: false, needsTeam: false })
/** A business reply that opens with whatever greeting the agent was handed, as the real model is told to. */
const business = (body: string, mode = 'pricing', extra: Partial<Ok> = {}): Step => (call) => ({
  reply: call.greetingLine ? `${call.greetingLine}\n${body}` : body,
  salesMove: 'PRICE_QUESTION' as never,
  conversationMode: mode as never,
  modeConfidence: 'high',
  personalClaims: false,
  escalationTopic: false,
  needsTeam: false,
  ...extra,
})

const ENV = ['IRE_CONVERSATIONAL_AGENCY_IDS', 'AGENT_RELIABILITY_AGENCY_IDS', 'NOTIFICATIONS_ENABLED', 'NOTIFICATIONS_AGENCY_ALLOWLIST', 'INBOX_QUALIFIER_KILL'] as const
const saved: Record<string, string | undefined> = {}
const enable = (...ids: number[]) => {
  process.env.IRE_CONVERSATIONAL_AGENCY_IDS = ids.join(',')
}

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
  delete process.env.INBOX_QUALIFIER_KILL
})
beforeEach(() => {
  enable()
  h.simCalls = []
  h.simScript = []
  workerCalls = []
  workerScript = []
  sent = []
})
afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  for (const tbl of ['analytics_events', 'notification_jobs', 'auto_response_jobs', 'conversation_turn_classification', 'conversation_ai_state', 'conversation_analysis_jobs', 'conversation_intelligence', 'qualify_draft_review', 'inbox_messages', 'inbox_participants', 'inbox_conversations', 'auto_response_settings']) {
    await db(tbl).whereIn('agencyId', agencies).del()
  }
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('the simulator runs the production conversational agent', () => {
  it('"היי מה קורה?" → personal: the same conversational call, and no business welcome in either', async () => {
    const t = await makeTenant('hi')
    enable(t.agencyId)
    const [p] = await playBoth(t, [{ say: 'היי מה קורה?', model: [personal('הכל טוב, מה איתך?')] }])
    expect(p).toMatchObject({ outcome: 'reply', reply: 'הכל טוב, מה איתך?', mode: 'personal', greeted: false })
    // The real agent IS handed the template line, conditionally ("only on a business turn"); the conversational prompt decides.
    expect((h.simCalls[0] as Call).conversational).toBeTruthy()
    expect((h.simCalls[0] as Call).greetingLine).toBe(templateGreeting(`מנכל SocialCrm hi`, 'he'))
  })

  it('"כמה עולה ה-CRM?" and "אחי כמה עולה CRM?" → business, greeted on the first reply only, exactly as production', async () => {
    const t = await makeTenant('price')
    enable(t.agencyId)
    const played = await playBoth(t, [
      { say: 'כמה עולה ה-CRM?', model: [business('המחיר הוא 89 ₪ לחודש. כמה לידים מגיעים אליכם בחודש?')] },
      { say: 'אחי כמה עולה CRM?', model: [business('כמו שכתבתי, 89 ₪ לחודש.')] },
    ])
    expect(played[0]).toMatchObject({ outcome: 'reply', greeted: true, mode: 'pricing' })
    expect(played[1]).toMatchObject({ outcome: 'reply', greeted: false })
  })

  it('personal → business → personal transitions keep the same memory and the same calls', async () => {
    const t = await makeTenant('mix')
    enable(t.agencyId)
    const played = await playBoth(t, [
      { say: 'מה קורה אחי?', model: [personal('הכל טוב אחי, אצלך?')] },
      { say: 'אני רוצה לשמוע על המערכת', model: [business('בשמחה. SocialCRM מרכזת את כל הלידים מהרשתות במקום אחד.', 'prospect')] },
      { say: 'סבבה, ומה איתך בכלל?', model: [personal('אצלי הכל טוב 😊')] },
    ])
    expect(played.map((p) => p.mode)).toEqual(['personal', 'prospect', 'personal'])
  })

  it('a person is requested → the same immediate handoff text, with no model call in either', async () => {
    const t = await makeTenant('human')
    enable(t.agencyId)
    const [p] = await playBoth(t, [{ say: 'אפשר לדבר עם נציג בבקשה?' }])
    expect(p.outcome).toBe('handoff')
    expect(h.simCalls).toHaveLength(0)
    expect(p.reply).toContain(handoffMessage('human_request', 'he'))
  })

  it('the model asks for the team (needsTeam) → the same escalation and fixed copy', async () => {
    const t = await makeTenant('team')
    enable(t.agencyId)
    const [p] = await playBoth(t, [{ say: 'אפשר לקבוע פגישה למחר בעשר?', model: [business('איזה יום נוח?', 'scheduling', { needsTeam: true })] }])
    expect(p).toMatchObject({ outcome: 'handoff' })
    expect(p.reply).toContain(handoffMessage(p.reason!, 'he'))
  })
})

describe('greeting rules are production’s', () => {
  it('the owner’s own greeting replaces the template in both', async () => {
    const t = await makeTenant('own', { agentProfile: { greeting: 'שלום! כאן הצוות של SocialCRM', persona: null, tone: null, faq: [], escalationTopics: [] } })
    enable(t.agencyId)
    const [p] = await playBoth(t, [{ say: 'כמה עולה?', model: [business('89 ₪ לחודש.')] }])
    expect((h.simCalls[0] as Call).greetingLine).toBe('שלום! כאן הצוות של SocialCRM')
    expect(p.reply.startsWith('שלום! כאן הצוות של SocialCRM')).toBe(true)
  })

  it('an EMPTY greeting field behaves as in production: the template line, conditionally', async () => {
    const t = await makeTenant('empty', { agentProfile: { greeting: '', persona: 'חברי וקליל', tone: null, faq: [], escalationTopics: [] } })
    enable(t.agencyId)
    await playBoth(t, [{ say: 'היי מה קורה?', model: [personal('הכל טוב!')] }])
    expect((h.simCalls[0] as Call).greetingLine).toBe(templateGreeting('מנכל SocialCrm empty', 'he'))
  })
})

describe('fallbacks are production’s', () => {
  it('a personal reply that fails validation twice → silence in both (never a business fallback or a greeting)', async () => {
    const t = await makeTenant('fallp')
    enable(t.agencyId)
    const tooLong = personal('א. ב. ג. ד. ה. ו. ז. ח.')
    const [p] = await playBoth(t, [{ say: 'מה נשמע?', model: [tooLong, tooLong] }])
    expect(p).toMatchObject({ outcome: 'silent', reply: '' })
  })

  it('an invented price that survives the repair → the same guardrail handoff in both', async () => {
    const t = await makeTenant('fallb')
    enable(t.agencyId)
    const invented = business('המחיר הוא 500 ₪ לחודש.')
    const [p] = await playBoth(t, [{ say: 'כמה עולה?', model: [invented, invented] }])
    expect(p).toMatchObject({ outcome: 'handoff', reason: 'guardrail' })
  })
})

describe('a failed model call', () => {
  it('production sends nothing and retries; the simulator reports the failure instead of a fake silence', async () => {
    const t = await makeTenant('aifail')
    enable(t.agencyId)
    const failed = { ok: false, skipReason: 'ai_unavailable' }
    h.respond = (async (args: Call, script: unknown[]) => (script[0] === 'fail' ? (script.shift(), failed) : answer(args, script))) as never
    try {
      workerScript = ['fail']
      sent = []
      const workerAnswer = (async (args: Call) => {
        workerCalls.push(args)
        return workerScript[0] === 'fail' ? (workerScript.shift(), failed) : answer(args, workerScript)
      }) as never
      await says(t, 'כמה עולה?')
      await runAutoResponseWorker({ deps: { send, generate: (async () => ({ ok: true, reply: 'x' })) as never, generateQualify: workerAnswer }, workerId: `parity-fail-${Math.random()}` })
      expect(sent).toEqual([])
      h.simScript = ['fail']
      const r = await simulateConversationalTurn({ agencyId: t.agencyId, settings: (await getChannelSettings(t.agencyId, 'whatsapp'))!, identity: await loadBusinessIdentity(t.agencyId, 'whatsapp'), transcript: [{ direction: 'inbound', text: 'כמה עולה?' }], state: sanitiseSimState(undefined), nowMs: Date.now() })
      expect(r).toEqual({ generationFailed: 'ai_unavailable' })
    } finally {
      h.respond = answer as never
    }
  })
})

describe('the simulator never acts', () => {
  it('no message, job, AI state, notification, lead or conversation is written', async () => {
    const t = await makeTenant('inert')
    enable(t.agencyId)
    const count = async () =>
      Object.fromEntries(
        await Promise.all(
          ['inbox_messages', 'auto_response_jobs', 'conversation_ai_state', 'notification_jobs', 'clients', 'inbox_conversations', 'analytics_events', 'qualify_draft_review'].map(async (tbl) => [tbl, Number((await db(tbl).where({ agencyId: t.agencyId }).count('* as n'))[0].n)]),
        ),
      )
    const before = await count()
    const settings = (await getChannelSettings(t.agencyId, 'whatsapp'))!
    const identity = await loadBusinessIdentity(t.agencyId, 'whatsapp')
    let state = sanitiseSimState(undefined)
    let transcript: SimTurn[] = []
    for (const [say, step] of [['היי מה קורה?', personal('הכל טוב')], ['כמה עולה?', business('89 ₪ לחודש.')], ['אפשר נציג?', null]] as const) {
      h.simScript = step ? [step] : []
      transcript = [...transcript, { direction: 'inbound', text: say }]
      const r = await simulateConversationalTurn({ agencyId: t.agencyId, settings, identity, transcript, state, nowMs: Date.now() })
      if ('unavailable' in r || 'generationFailed' in r) throw new Error('unavailable')
      state = r.state
      if (r.reply) transcript = [...transcript, { direction: 'outbound', text: r.reply }]
    }
    expect(state.aiState).toBe('escalated') // the would-be state is returned…
    expect(await count()).toEqual(before) // …and nothing was written.
  })

  it('state from the browser is rebuilt, never trusted', () => {
    expect(sanitiseSimState({ aiState: 'root', aiTurnCount: -4, qualification: 'x' })).toEqual({ aiState: 'new', aiTurnCount: 0, qualification: {} })
  })
})

describe('who gets which simulator', () => {
  it('a flagged agency whose WhatsApp does not run the conversational agent gets a clear reason, not the legacy preview', async () => {
    for (const opts of [{ mode: 'acknowledge' as const }, { responder: 'questionnaire' as const }]) {
      const t = await makeTenant(`na-${Object.values(opts)[0]}`, opts)
      enable(t.agencyId)
      const r = await previewConversationalTurn({ agencyId: t.agencyId, draftIdentity: { guidance: 'x', agentInstructions: null, profile: null }, usedDraft: false, profileDerived: false, transcript: [{ direction: 'inbound', text: 'היי' }], state: undefined })
      expect(r).toEqual({ ok: false, reason: 'conversational_unavailable' })
    }
  })

  it('the kill switch pauses the simulator exactly as it pauses the agent', async () => {
    const t = await makeTenant('kill')
    enable(t.agencyId)
    process.env.INBOX_QUALIFIER_KILL = '1'
    try {
      const r = await previewConversationalTurn({ agencyId: t.agencyId, draftIdentity: { guidance: 'x', agentInstructions: null, profile: null }, usedDraft: false, profileDerived: false, transcript: [{ direction: 'inbound', text: 'היי' }], state: undefined })
      expect(r).toEqual({ ok: false, reason: 'agent_paused' })
    } finally {
      delete process.env.INBOX_QUALIFIER_KILL
    }
  })

  it('the preview action: flagged → the real agent (returns its state); not flagged → the existing preview, unchanged', async () => {
    const t = await makeTenant('action')
    h.user = { id: t.userId, agencyId: t.agencyId, role: 'ADMIN' }

    enable(t.agencyId)
    h.simScript = [personal('הכל טוב, מה איתך?')]
    const flagged = await previewAgentTurn({ transcript: [{ direction: 'inbound', text: 'היי מה קורה?' }] })
    expect(flagged).toMatchObject({ ok: true, reply: 'הכל טוב, מה איתך?', trace: { mode: 'personal', greeted: false } })
    expect(flagged.ok && flagged.state).toMatchObject({ aiTurnCount: 1 })
    expect((h.simCalls.at(-1) as Call).conversational).toBeTruthy()

    enable()
    h.simCalls = []
    h.simScript = [{ reply: 'היי, ברוך הבא! איך אפשר לעזור?' }]
    const legacy = await previewAgentTurn({ transcript: [{ direction: 'inbound', text: 'היי מה קורה?' }] })
    expect(legacy.ok).toBe(true)
    expect(legacy.ok && legacy.state).toBeUndefined()
    expect((h.simCalls.at(-1) as Call).conversational).toBeUndefined()
  })
})

describe('the test chat can use the unsaved greeting, tone and FAQ', () => {
  const SAVED = { greeting: 'שלום מהסטודיו', persona: null, tone: 'formal', faq: [{ question: 'יש חניה?', answer: 'כן, חניה חינם בחזית' }], escalationTopics: [] }
  const ask = (extra: Record<string, unknown> = {}) =>
    previewAgentTurn({ transcript: [{ direction: 'inbound', text: 'כמה עולה?' }], ...extra } as Parameters<typeof previewAgentTurn>[0])
  const lastCall = () => JSON.stringify(h.simCalls.at(-1))

  it('without the new fields: the saved profile, exactly as before', async () => {
    const t = await makeTenant('draft-none', { agentProfile: SAVED })
    h.user = { id: t.userId, agencyId: t.agencyId, role: 'ADMIN' }
    enable(t.agencyId)
    h.simScript = [business('89 ₪ לחודש.')]
    const r = await ask()
    expect(r).toMatchObject({ ok: true, usedDraft: false })
    expect((h.simCalls.at(-1) as Call).greetingLine).toBe('שלום מהסטודיו')
    expect(lastCall()).toContain('כן, חניה חינם בחזית')
  })

  it('unsaved greeting, tone and FAQ reach the real agent; the reply says it used unsaved text; nothing is saved', async () => {
    const t = await makeTenant('draft-all', { agentProfile: SAVED })
    h.user = { id: t.userId, agencyId: t.agencyId, role: 'ADMIN' }
    enable(t.agencyId)
    const before = await db('auto_response_settings').where({ agencyId: t.agencyId }).first('agentProfile', 'updatedAt')
    h.simScript = [business('89 ₪ לחודש.')]
    const r = await ask({
      draftGreeting: 'היי! כאן הסטודיו של דנה',
      draftTone: 'friendly',
      draftFaq: [{ question: 'עובדים בשבת?', answer: 'לא, רק א׳–ה׳' }],
    })
    expect(r).toMatchObject({ ok: true, usedDraft: true })
    expect(r.ok && r.reply.startsWith('היי! כאן הסטודיו של דנה')).toBe(true)
    expect((h.simCalls.at(-1) as Call).greetingLine).toBe('היי! כאן הסטודיו של דנה')
    expect(lastCall()).toContain('לא, רק א׳–ה׳')
    expect(lastCall()).not.toContain('כן, חניה חינם בחזית')
    expect(await db('auto_response_settings').where({ agencyId: t.agencyId }).first('agentProfile', 'updatedAt')).toEqual(before)
  })

  it('an emptied greeting falls back to the template line, as an empty saved greeting does', async () => {
    const t = await makeTenant('draft-empty', { agentProfile: SAVED })
    h.user = { id: t.userId, agencyId: t.agencyId, role: 'ADMIN' }
    enable(t.agencyId)
    h.simScript = [business('89 ₪ לחודש.')]
    await ask({ draftGreeting: '' })
    expect((h.simCalls.at(-1) as Call).greetingLine).toBe(templateGreeting('מנכל SocialCrm draft-empty', 'he'))
  })
})
