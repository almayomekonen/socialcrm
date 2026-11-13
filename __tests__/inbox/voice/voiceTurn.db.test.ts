import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { transcribePendingVoiceNotes } from '@/lib/inbox/voice/transcribePending'
import type { QualifyGenResult } from '@/lib/inbox/autoresponse/qualify'
import { oggOpus } from '../../ai/agent/voice/audioFixtures'

/**
 * WhatsApp voice notes, end to end against a real database: the webhook's own
 * ingest, the job queue, the real worker and the agent's real turn. Faked, and
 * COUNTED: WhatsApp's Graph media endpoints (global fetch), the transcription
 * provider, the AI admission gate's answer, the send and the model. Nothing
 * real is downloaded, transcribed, charged or sent.
 */

const h = vi.hoisted(() => ({
  admit: true,
  transcribe: vi.fn(),
  graph: [] as Array<{ url: string; auth: string | null }>,
  media: new Map<string, { bytes: Uint8Array; fileSize?: number; lookupStatus?: number }>(),
}))

vi.mock('@/lib/agent/voice/transcribe', () => ({
  transcribeVoice: h.transcribe,
  VoiceTranscriptionUnavailableError: class VoiceTranscriptionUnavailableError extends Error {},
}))
vi.mock('@/lib/ai/gate', async (orig) => {
  const real = (await orig()) as typeof import('@/lib/ai/gate')
  return {
    ...real,
    admitAiRun: vi.fn(async (input: Parameters<typeof real.admitAiRun>[0]) =>
      input.kind === 'inbox.autoResponse' ? (h.admit ? { ok: true, cfg: {}, effectiveRole: 'fast', chain: [] } : { ok: false, reason: 'over-quota' }) : real.admitAiRun(input),
    ),
  }
})

const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const auth = new Headers(init?.headers).get('authorization')
  h.graph.push({ url, auth })
  const lookup = url.match(/graph\.facebook\.com\/[^/]+\/([^/?]+)$/)
  if (lookup) {
    const m = h.media.get(decodeURIComponent(lookup[1]))
    if (!m) return new Response('{}', { status: 404 })
    if (m.lookupStatus) return new Response('{}', { status: m.lookupStatus })
    return Response.json({ url: `https://lookaside.example/${lookup[1]}`, mime_type: 'audio/ogg; codecs=opus', file_size: m.fileSize ?? m.bytes.byteLength })
  }
  const file = url.match(/^https:\/\/lookaside\.example\/(.+)$/)
  if (file) {
    const m = h.media.get(decodeURIComponent(file[1]))
    return m ? new Response(m.bytes as BodyInit, { status: 200, headers: { 'content-length': String(m.bytes.byteLength) } }) : new Response('', { status: 404 })
  }
  return new Response('', { status: 404 })
})

let sent: Array<{ to: string; body: string }> = []
let modelCalls: Array<{ transcript: Array<{ direction: string; text: string; voice?: true }> }> = []
const send = (async (args: { to: string; body: string }) => {
  sent.push({ to: args.to, body: args.body })
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never
const generateQualify = (async (args: { transcript: Array<{ direction: string; text: string; voice?: true }> }): Promise<QualifyGenResult> => {
  modelCalls.push({ transcript: args.transcript })
  return {
    ok: true,
    reply: 'בשמחה, לאיזה יום נוח לך?',
    extracted: {},
    corrected: [],
    objective: 'discover_need',
    understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
    salesMove: 'DISCOVERY',
    hotSignal: false,
    uncertain: false,
    model: 'fake',
  }
}) as never
const generate = (async () => ({ ok: true, reply: 'תודה שפנית' })) as never
const drain = () => runAutoResponseWorker({ deps: { send, generate, generateQualify }, workerId: `voice-${Math.random()}` })

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; leadId: number; conversationId: number; phoneNumberId: string; customerWaId: string; token: string }

async function makeTenant(opts: { id?: number; enabled?: boolean } = {}): Promise<Tenant> {
  const [a] = await db('agencies')
    .insert({ ...(opts.id ? { id: opts.id } : {}), name: `עסק קולי ${opts.id ?? ''}`, autoResponseEnabled: true, plan: 'free', trialExempt: true })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `voice_pn_${agencyId}`
  const customerWaId = `97254${String(agencyId).padStart(7, '0')}`
  const token = `token-of-${agencyId}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: token })
  await db('auto_response_settings').insert({ agencyId, channel: 'whatsapp', enabled: opts.enabled ?? true, mode: 'qualify', responder: 'agent', replyMode: 'ai', updatedBy: userId })
  const [c] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'כהן', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: 'new' })
    .returning('id')
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId: Number(c.id), channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId })
    .returning('id')
  return { agencyId, userId, leadId: Number(c.id), conversationId: Number(conv.id), phoneNumberId, customerWaId, token }
}

const customer = (t: Tenant, message: Record<string, unknown>, wamid = `wamid.in.${Math.random().toString(36).slice(2)}`) =>
  ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דנה כהן',
    rawMessage: { id: wamid, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), ...message },
  })

/** A voice note exactly as WhatsApp delivers it: an audio object with a media id, nothing else. */
function voiceNote(t: Tenant, opts: { bytes?: Uint8Array; fileSize?: number; lookupStatus?: number } = {}, wamid?: string) {
  const mediaId = `media-${t.agencyId}-${Math.random().toString(36).slice(2)}`
  h.media.set(mediaId, { bytes: opts.bytes ?? oggOpus(6_000), fileSize: opts.fileSize, lookupStatus: opts.lookupStatus })
  return customer(t, { type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', sha256: 'x', voice: true } }, wamid).then((r) => ({ ...r, mediaId }))
}
const says = (t: Tenant, body: string) => customer(t, { type: 'text', text: { body } })
const storedTranscription = async (messageId: number) => ((await db('inbox_messages').where({ id: messageId }).first('payload', 'text')) as { payload: { transcription?: Record<string, unknown> }; text: string })

const spoken = (text: string) => async () => ({ text })

// The worker drains every agency's queue, so each test looks only at ITS tenant.
const sentTo = (t: Tenant) => sent.filter((m) => m.to === t.customerWaId)
const transcribedFor = (t: Tenant) => h.transcribe.mock.calls.filter((c) => c[0]?.ledger?.agencyId === t.agencyId)
const graphFor = (t: Tenant) => h.graph.filter((g) => g.auth === `Bearer ${t.token}`)

let savedEnv: Record<string, string | undefined> = {}
const ENV = ['IRE_CONVERSATIONAL_AGENCY_IDS', 'AGENT_RELIABILITY_AGENCY_IDS', 'SMARTBEE_AGENCY_IDS']
beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  // Production today: the conversational agent is `all`; SmartBee is irrelevant here and left unset.
  process.env.IRE_CONVERSATIONAL_AGENCY_IDS = 'all'
  delete process.env.SMARTBEE_AGENCY_IDS
  vi.stubGlobal('fetch', fakeFetch)
  // Make room for explicit ids (103, 167, 69) without colliding with the sequence.
  await db.raw(`SELECT setval(pg_get_serial_sequence('agencies','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM agencies), 5000))`)
})
beforeEach(async () => {
  // Earlier tests' deferred jobs must not run inside this one.
  if (agencies.length) await db('auto_response_jobs').whereIn('agencyId', agencies).whereIn('status', ['pending', 'processing']).del()
  sent = []
  modelCalls = []
  h.admit = true
  h.graph = []
  h.transcribe.mockReset()
  h.transcribe.mockImplementation(spoken('שלום, אני רוצה לקבוע תור לטיפול ביום שלישי בעשר, הטלפון שלי 052-1234567'))
  process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
})
afterEach(() => vi.useRealTimers())
afterAll(async () => {
  vi.unstubAllGlobals()
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  await db('analytics_events').whereIn('agencyId', agencies).del()
  await db('notification_jobs').whereIn('agencyId', agencies).del()
  await db('auto_response_jobs').whereIn('agencyId', agencies).del()
  await db('conversation_turn_classification').whereIn('agencyId', agencies).del()
  await db('conversation_ai_state').whereIn('agencyId', agencies).del()
  await db('conversation_analysis_jobs').whereIn('agencyId', agencies).del()
  await db('conversation_intelligence').whereIn('agencyId', agencies).del()
  await db('inbox_messages').whereIn('agencyId', agencies).del()
  await db('inbox_participants').whereIn('agencyId', agencies).del()
  await db('inbox_conversations').whereIn('agencyId', agencies).del()
  await db('auto_response_settings').whereIn('agencyId', agencies).del()
  await db('tasks').whereIn('clientId', db('clients').select('id').whereIn('agencyId', agencies)).del()
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('a voice note reaches the SAME agent turn as typed text', () => {
  it('Hebrew: transcribed once, stored on the row, read by the agent as a spoken customer turn, answered', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    await drain()

    expect(h.transcribe).toHaveBeenCalledTimes(1)
    const call = h.transcribe.mock.calls[0][0]
    expect(call.use).toMatchObject({ mediaType: 'audio/ogg', feature: 'whatsapp.voice.transcribe', maxDurationMs: 300_000 })
    expect(call.ledger).toEqual({ agencyId: t.agencyId, userId: null })
    expect(call.use.prompt).toContain(`עסק קולי`)

    const row = await storedTranscription(messageId)
    expect(row.payload.transcription).toMatchObject({ status: 'ok', text: 'שלום, אני רוצה לקבוע תור לטיפול ביום שלישי בעשר, הטלפון שלי 052-1234567', model: 'gpt-4o-transcribe' })
    expect(row.text).toBe('') // the inbox row is untouched

    expect(modelCalls).toHaveLength(1)
    const last = modelCalls[0].transcript.at(-1)!
    // Amounts, times and the phone number arrive exactly as spoken.
    expect(last).toEqual({ direction: 'inbound', text: 'שלום, אני רוצה לקבוע תור לטיפול ביום שלישי בעשר, הטלפון שלי 052-1234567', voice: true })
    expect(sentTo(t)).toHaveLength(1)
    expect(sentTo(t)[0]).toMatchObject({ to: t.customerWaId, body: expect.stringContaining('בשמחה, לאיזה יום נוח לך?') })
    expect(sentTo(t)[0].body).not.toMatch(/תמלול|הקלטה|transcri/i)
  })

  it('another language: no language is forced, and the words arrive as spoken', async () => {
    h.transcribe.mockImplementation(spoken('Hi, how much is a full service for a 2019 Corolla?'))
    const t = await makeTenant()
    await voiceNote(t)
    await drain()
    expect(h.transcribe.mock.calls[0][0]).not.toHaveProperty('language')
    expect(modelCalls[0].transcript.at(-1)).toEqual({ direction: 'inbound', text: 'Hi, how much is a full service for a 2019 Corolla?', voice: true })
  })

  it('keeps the conversation: earlier typed turns and the voice note reach the model in order', async () => {
    const t = await makeTenant()
    await says(t, 'היי, יש לכם תורים השבוע?')
    await drain()
    h.transcribe.mockImplementation(spoken('כן, ואם אפשר גם החלפת צמיגים'))
    await voiceNote(t)
    await drain()
    const transcript = modelCalls.at(-1)!.transcript
    expect(transcript[0]).toEqual({ direction: 'inbound', text: 'היי, יש לכם תורים השבוע?' })
    expect(transcript.at(-1)).toEqual({ direction: 'inbound', text: 'כן, ואם אפשר גם החלפת צמיגים', voice: true })
    expect(transcript.some((m) => m.direction === 'outbound')).toBe(true)
  })

  it('the agent safeguards act on the spoken words: asking for a person hands off, with no model reply', async () => {
    h.transcribe.mockImplementation(spoken('אני רוצה לדבר עם נציג אנושי בבקשה'))
    const t = await makeTenant()
    await voiceNote(t)
    await drain()
    expect(modelCalls).toHaveLength(0)
    const state = await db('conversation_ai_state').where({ conversationId: t.conversationId }).first('aiState')
    expect(state?.aiState).toBe('escalated')
  })
})

describe('a voice note that is NOT understood is never answered from a guess', () => {
  const unclear = 'קיבלתי את ההקלטה, אבל לא הצלחתי לשמוע אותה ברור. אפשר לשלוח אותה שוב, או לכתוב לי בכמה מילים?'

  it('provider failure: recorded as failed, the customer is asked to resend or write, no model call', async () => {
    h.transcribe.mockRejectedValue(new Error('upstream 500'))
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    await drain()
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'failed', code: 'transcription_failed' })
    expect(modelCalls).toHaveLength(0)
    expect(sentTo(t)).toHaveLength(1)
    expect(sentTo(t)[0].body).toContain(unclear)
  })

  it('provider timeout: recorded as a timeout, same honest fallback', async () => {
    h.transcribe.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    await drain()
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'failed', code: 'transcription_timeout' })
    expect(sentTo(t)[0].body).toContain(unclear)
  })

  it('silence or noise (nothing said): empty, fallback', async () => {
    h.transcribe.mockImplementation(spoken(' … '))
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    await drain()
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'empty', code: 'no_speech' })
    expect(modelCalls).toHaveLength(0)
    expect(sentTo(t)[0].body).toContain(unclear)
  })

  it('an unsupported format (AMR) is refused before the provider is paid', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t, { bytes: new TextEncoder().encode('#!AMR\n' + 'x'.repeat(4000)) })
    await drain()
    expect(h.transcribe).not.toHaveBeenCalled()
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'unsupported' })
    expect(sentTo(t)[0].body).toContain(unclear)
  })

  it('a recording longer than five minutes is refused before the provider is paid', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t, { bytes: oggOpus(6 * 60_000) })
    await drain()
    expect(h.transcribe).not.toHaveBeenCalled()
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'too_long' })
  })

  it('a file over 16 MB is refused from Graph\'s declared size, without downloading it', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t, { fileSize: 20 * 1024 * 1024 })
    await drain()
    expect(h.graph.filter((g) => g.url.startsWith('https://lookaside.example/'))).toHaveLength(0)
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'too_large' })
  })

  it('a Graph failure (media expired or unreachable): failed, fallback, no provider call', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t, { lookupStatus: 500 })
    await drain()
    expect(h.transcribe).not.toHaveBeenCalled()
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'failed', code: 'media_lookup_failed' })
    expect(sentTo(t)[0].body).toContain(unclear)
  })

  it('a second unclear note right after the fallback is not met with the same line again', async () => {
    h.transcribe.mockRejectedValue(new Error('x'))
    const t = await makeTenant()
    await voiceNote(t)
    await drain()
    await voiceNote(t)
    await drain()
    expect(sentTo(t)).toHaveLength(1)
  })
})

describe('cost controls and the existing gates', () => {
  it('AI not admitted (over the daily cap, not entitled, AI off): nothing is downloaded or transcribed', async () => {
    h.admit = false
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    await drain()
    expect(graphFor(t)).toHaveLength(0)
    expect(transcribedFor(t)).toHaveLength(0)
    expect((await storedTranscription(messageId)).payload.transcription).toBeUndefined()
  })

  it('auto-response off for the channel: nothing is downloaded or transcribed', async () => {
    const t = await makeTenant({ enabled: false })
    await voiceNote(t)
    await drain()
    expect(graphFor(t)).toHaveLength(0)
    expect(transcribedFor(t)).toHaveLength(0)
  })

  it('out of the per-turn time budget: the note is honestly NOT understood, never transcribed or redone later', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    const run = (budgetMs: number) => transcribePendingVoiceNotes({ agencyId: t.agencyId, conversationId: t.conversationId, businessPhoneNumberId: t.phoneNumberId, autoResponseOn: true, deps: { budgetMs } })
    expect(await run(0)).toMatchObject({ attempted: 0, understood: 0 })
    expect(transcribedFor(t)).toHaveLength(0)
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ status: 'failed', code: 'turn_time_budget' })
    expect(await run(60_000)).toMatchObject({ skipped: 'none_pending' })
  })

  it('a slow provider is cut off at what is left of the budget, newest note first', async () => {
    const t = await makeTenant()
    const older = await voiceNote(t)
    const newer = await voiceNote(t)
    const signals: number[] = []
    h.transcribe.mockImplementation(async (input: { abortSignal: AbortSignal }) => {
      signals.push(Date.now())
      await new Promise((resolve, reject) => input.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))))
      return { text: 'never' }
    })
    const started = Date.now()
    await transcribePendingVoiceNotes({ agencyId: t.agencyId, conversationId: t.conversationId, businessPhoneNumberId: t.phoneNumberId, autoResponseOn: true, deps: { budgetMs: 4_000 } })
    expect(Date.now() - started).toBeLessThan(6_000)
    expect(transcribedFor(t)).toHaveLength(1)
    expect((await storedTranscription(newer.messageId)).payload.transcription).toMatchObject({ status: 'failed', code: 'transcription_timeout' })
    expect((await storedTranscription(older.messageId)).payload.transcription).toMatchObject({ status: 'failed', code: 'turn_time_budget' })
  }, 15_000)

  it('at most three voice notes are transcribed in one turn', async () => {
    const t = await makeTenant()
    for (let i = 0; i < 5; i++) await voiceNote(t)
    await drain()
    expect(transcribedFor(t)).toHaveLength(3)
  })
})

describe('idempotency', () => {
  it('a duplicate webhook delivery (same wamid) is one row, one job, one transcription, one reply', async () => {
    const t = await makeTenant()
    const wamid = `wamid.dup.${t.agencyId}`
    const first = await voiceNote(t, {}, wamid)
    const again = await voiceNote(t, {}, wamid)
    expect(again.inserted).toBe(false)
    expect(again.messageId).toBe(first.messageId)
    await drain()
    await drain()
    expect(transcribedFor(t)).toHaveLength(1)
    expect(sentTo(t)).toHaveLength(1)
    // One job from the inbound (the no-response follow-up the reply schedules is not a second reply).
    expect(await db('auto_response_jobs').where({ conversationId: t.conversationId }).whereNotIn('reason', ['no_response_warning', 'no_response_close']).count('* as n').first()).toMatchObject({ n: '1' })
  })

  it('a retried job never transcribes the same note again, and never overwrites the stored result', async () => {
    const t = await makeTenant()
    const { messageId } = await voiceNote(t)
    const run = () => transcribePendingVoiceNotes({ agencyId: t.agencyId, conversationId: t.conversationId, businessPhoneNumberId: t.phoneNumberId, autoResponseOn: true })
    expect(await run()).toMatchObject({ attempted: 1, understood: 1 })
    h.transcribe.mockImplementation(spoken('משהו אחר לגמרי'))
    expect(await run()).toMatchObject({ attempted: 0, skipped: 'none_pending' })
    expect((await storedTranscription(messageId)).payload.transcription).toMatchObject({ text: expect.stringContaining('לקבוע תור') })
  })
})

describe('universal: every agency the agent serves, no allowlist, no agency id', () => {
  it('works identically for agencies 103, 167, 69 and a brand-new id, with no voice flag or list set', async () => {
    for (const k of Object.keys(process.env)) if (/VOICE|TRANSCRI/i.test(k)) expect(process.env[k]).toBeUndefined()
    for (const id of [103, 167, 69, 2_000_001]) {
      const exists = await db('agencies').where({ id }).first('id')
      const t = exists ? await makeTenant() : await makeTenant({ id })
      sent = []
      modelCalls = []
      await voiceNote(t)
      await drain()
      expect(transcribedFor(t)).toHaveLength(1)
      expect(modelCalls.some((c) => c.transcript.at(-1)?.voice === true)).toBe(true)
      expect(sentTo(t)).toHaveLength(1)
    }
  })

  it('agency isolation: each agency\'s note is fetched with its OWN token and only its own rows change', async () => {
    const a = await makeTenant()
    const b = await makeTenant()
    const na = await voiceNote(a)
    const nb = await voiceNote(b)
    await transcribePendingVoiceNotes({ agencyId: a.agencyId, conversationId: a.conversationId, businessPhoneNumberId: a.phoneNumberId, autoResponseOn: true })
    expect(h.graph.length).toBeGreaterThan(0)
    expect(h.graph.every((g) => g.auth === `Bearer ${a.token}`)).toBe(true)
    expect(h.graph.some((g) => g.url.includes(na.mediaId))).toBe(true)
    expect(h.graph.some((g) => g.url.includes(nb.mediaId))).toBe(false)
    expect((await storedTranscription(nb.messageId)).payload.transcription).toBeUndefined()
    // Another agency's conversation id under this agency's id finds nothing to do.
    expect(await transcribePendingVoiceNotes({ agencyId: a.agencyId, conversationId: b.conversationId, businessPhoneNumberId: a.phoneNumberId, autoResponseOn: true })).toMatchObject({ skipped: 'none_pending' })
  })
})

describe('text messages are unchanged', () => {
  it('a typed message makes no media call and reaches the model with no voice marker', async () => {
    const t = await makeTenant()
    await says(t, 'כמה עולה טיפול שנתי?')
    await drain()
    expect(graphFor(t)).toHaveLength(0)
    expect(transcribedFor(t)).toHaveLength(0)
    expect(modelCalls.find((c) => c.transcript.at(-1)?.text === 'כמה עולה טיפול שנתי?')?.transcript.at(-1)).toEqual({ direction: 'inbound', text: 'כמה עולה טיפול שנתי?' })
  })
})
