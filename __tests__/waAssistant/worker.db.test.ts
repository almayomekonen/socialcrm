import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The assistant worker against a real PostgreSQL: authority re-checked every
 * turn, limits, the reply window, exactly one reply, nothing ever performed,
 * and bounded memory. The Agent, the sender and the typing indicator are
 * injected; nothing reaches Meta or a model.
 *
 * NOTE: over the 250-line soft limit on purpose: one flat list of independent
 * scenarios sharing the harness, queueing and fixture helpers; splitting it
 * would duplicate those across files for no readability gain.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { COPY, NO_ACTIONS_NOTE } from '@/lib/waAssistant/render'
import { WA_ASSISTANT_LIMITS } from '@/lib/flags/waAssistantFlags'
import { MAX_REPLY_CHARS, TYPING_TIMEOUT_MS, buildPlatformTextPayload } from '@/lib/whatsapp/platform/sendText'
import { SEND_TIMEOUT_MS } from '@/lib/ownerWhatsappReminders/constants'
import { maxDuration as cronMaxDuration } from '@/app/api/cron/wa-assistant/route'
import { maxDuration as webhookMaxDuration } from '@/app/api/webhooks/whatsapp/route'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

const A = 103
let B: number
let seq = 0
const DAY = 24 * 60 * 60 * 1000

const answer = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  answer: { headline: 'היום יש 2 לידים שמחכים למענה', claims: [{ claimClass: 'FACT', text: 'דניאל כהן מחכה 3 שעות (054-1234567)', entityEvidence: ['lead:1'] }], unknown: null, ...over },
  evidence: [],
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: 'inv_test',
  costUsd: 0.01,
})

function harness(agentResult: unknown = answer()) {
  const runAgent = vi.fn(async (_input: Record<string, any>) => agentResult as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.REPLY_${++seq}` }))
  const typing = vi.fn(async () => undefined)
  return { runAgent, sendText, typing, deps: { runAgent: runAgent as never, sendText: sendText as never, typing: typing as never } }
}

async function ask(from: string, body: string, opts: { at?: number; type?: string } = {}) {
  const ts = Math.floor((opts.at ?? Date.now()) / 1000)
  const id = `wamid.__wa_wk_${++seq}`
  const msg = opts.type ? { id, from, timestamp: String(ts), type: opts.type, [opts.type]: { id: 'x' } } : { id, from, timestamp: String(ts), type: 'text', text: { body } }
  expect(await processPlatformMessage(msg)).toBe('assistant_queued')
  return id
}
async function owner(digits: string, role = 'ADMIN', agencyId = A) {
  const u = await user(agencyId, role)
  const r = await recipient(agencyId, u, digits)
  return { u, r }
}
const job = (wamid: string) => db('wa_assistant_jobs').where({ wamid }).first()

beforeAll(async () => {
  await agency('__wa_wk_103__', A)
  B = await agency('__wa_wk_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('wa_assistant_jobs').del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  process.env.WA_ASSISTANT_AGENCY_IDS = String(A)
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  delete process.env.WA_ASSISTANT_DAILY_USD_CAP
})
afterAll(async () => {
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN']) delete process.env[k]
  await db('wa_assistant_jobs').del()
  await cleanup()
})

describe('a question, answered once', () => {
  it('runs the existing Agent read-only with the recipient\'s own scope, and replies once, redacted', async () => {
    const { u } = await owner('972500006001')
    const w = await ask('972500006001', 'סכם לי את היום')
    const h = harness()
    expect((await runWaAssistantWorker({}, h.deps)).outcomes).toEqual({ answered: 1 })
    const input = h.runAgent.mock.calls[0][0]
    expect(input).toMatchObject({ question: 'סכם לי את היום', history: [], disableResearch: true, skipInteractiveSpend: true, maxSteps: 5, deadlineMs: 35_000 })
    expect(input.scope).toMatchObject({ agencyId: A, userId: u, role: 'ADMIN', gotPermIds: [] })
    expect(h.typing).toHaveBeenCalledWith(expect.objectContaining({ inboundWamid: w }))
    expect(h.sendText).toHaveBeenCalledTimes(1)
    const sent = h.sendText.mock.calls[0][0]
    expect(sent).toMatchObject({ toE164: '+972500006001', replyToWamid: w, phoneNumberId: PLATFORM })
    expect(sent.body).toContain('היום יש 2 לידים שמחכים למענה')
    expect(sent.body).not.toContain('054-1234567')
    expect(await job(w)).toMatchObject({ status: 'answered', replyState: 'sent', answerHeadline: 'היום יש 2 לידים שמחכים למענה' })
  })

  it('a second worker pass never answers the same message again', async () => {
    await owner('972500006002')
    await ask('972500006002', 'מי לא קיבל מענה?')
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(h.sendText).toHaveBeenCalledTimes(1)
  })

  it('a non-admin gets their own permission set (tenant + rep visibility)', async () => {
    const { u } = await owner('972500006003', 'AGNT')
    await ask('972500006003', 'תמצא את הליד דניאל')
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    const scope = h.runAgent.mock.calls[0][0].scope
    expect(scope).toMatchObject({ agencyId: A, userId: u, role: 'AGNT' })
    expect(scope.gotPermIds).toContain(u)
  })

  it('one sender\'s messages run one at a time, and the next one sees the previous exchange', async () => {
    await owner('972500006004')
    await ask('972500006004', 'תמצא את הליד דניאל')
    await ask('972500006004', 'מה הסטטוס שלו?')
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).toHaveBeenCalledTimes(2)
    expect(h.runAgent.mock.calls[1][0].history).toEqual([
      { role: 'user', content: 'תמצא את הליד דניאל' },
      { role: 'assistant', content: 'היום יש 2 לידים שמחכים למענה' },
    ])
  })

  it('an answer that proposes an action performs nothing and says so', async () => {
    await owner('972500006005')
    await ask('972500006005', 'קבע לי פגישה עם דניאל')
    const h = harness(answer({ proposedAction: { actionType: 'create_meeting', targetLeadId: 1, args: {}, evidenceRefs: ['lead:1'] } }))
    await runWaAssistantWorker({}, h.deps)
    expect(h.sendText.mock.calls[0][0].body).toContain(NO_ACTIONS_NOTE)
    expect(await db('agent_actions').count<{ count: string }>('* as count').first()).toEqual({ count: '0' })
  })

  it('a LONG answer that proposes an action still ends with the note in what is sent', async () => {
    await owner('972500006006')
    await ask('972500006006', 'סכם לי את היום וקבע פגישה')
    const claims = Array.from({ length: 6 }, (_, i) => ({ claimClass: 'FACT', text: `טענה ${i} ${'א'.repeat(400)}`, entityEvidence: ['lead:1'] }))
    const h = harness(answer({ claims, proposedAction: { actionType: 'create_meeting', targetLeadId: 1, args: {}, evidenceRefs: ['lead:1'] } }))
    await runWaAssistantWorker({}, h.deps)
    const sent = h.sendText.mock.calls[0][0].body as string
    const payload = buildPlatformTextPayload({ toDigits: '972500006006', body: sent }).text.body
    expect(payload.endsWith(`\n\n${NO_ACTIONS_NOTE}`)).toBe(true)
    expect(payload.length).toBeLessThanOrEqual(MAX_REPLY_CHARS)
  })
})

describe('execution budget', () => {
  it('one pass claims only what it can finish inside both entry points\' function limits', () => {
    // The worker runs from the cron route and from the webhook route's `after()`.
    const worstJobMs = TYPING_TIMEOUT_MS + WA_ASSISTANT_LIMITS.deadlineMs + SEND_TIMEOUT_MS
    const limitMs = Math.min(cronMaxDuration, webhookMaxDuration) * 1000
    expect(WA_ASSISTANT_LIMITS.batch).toBe(1)
    expect(WA_ASSISTANT_LIMITS.batch * worstJobMs).toBeLessThan(limitMs)
  })

  it('with several senders waiting, a pass claims one job and leaves the rest queued', async () => {
    await owner('972500006050')
    await owner('972500006051')
    await owner('972500006052')
    const ids = [await ask('972500006050', 'א'), await ask('972500006051', 'ב'), await ask('972500006052', 'ג')]
    const h = harness()
    const s = await runWaAssistantWorker({}, h.deps)
    expect(s.claimed).toBe(1)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    const states = await db('wa_assistant_jobs').whereIn('wamid', ids).pluck('status')
    expect(states.filter((x) => x === 'answered')).toHaveLength(1)
    expect(states.filter((x) => x === 'queued')).toHaveLength(2)
    expect(await db('wa_assistant_jobs').where({ status: 'running' }).count<{ count: string }>('* as count').first()).toEqual({ count: '0' })
  })
})

describe('authority re-checked on every turn: no model call, no data', () => {
  it.each([
    ['the user was suspended', async (o: { u: number; r: number }) => { await db('users').where({ id: o.u }).update({ suspended: true }) }],
    ['the recipient opted out', async (o: { u: number; r: number }) => { await db('owner_whatsapp_recipients').where({ id: o.r }).update({ status: 'opted_out', optedOutAt: new Date() }) }],
    ['the user moved to another agency', async (o: { u: number; r: number }) => { await db('users').where({ id: o.u }).update({ agencyId: B }) }],
    ['the flag was removed', async () => { process.env.WA_ASSISTANT_AGENCY_IDS = '' }],
    ['the number became ambiguous', async () => { await recipient(B, await user(B), '972500006010') }],
  ])('%s: silent', async (_label, mutate) => {
    const o = await owner('972500006010')
    const w = await ask('972500006010', 'סכם לי את היום')
    await mutate(o)
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText).not.toHaveBeenCalled()
    expect(await job(w)).toMatchObject({ status: 'refused', replyState: 'skipped' })
  })

  it.each([
    ['product access expired', async () => { await db('agencies').where({ id: A }).update({ plan: 'free', trialStartedAt: new Date(Date.now() - 10 * DAY), trialEndsAt: new Date(Date.now() - 3 * DAY) }) }],
    ['the Agent rollout was turned off', async () => { flags.agent = false }],
  ])('%s: a fixed "not available" reply, no model call', async (_label, mutate) => {
    await owner('972500006011')
    const w = await ask('972500006011', 'סכם לי את היום')
    await mutate()
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText.mock.calls[0][0].body).toBe(COPY.notAvailable)
    expect(await job(w)).toMatchObject({ status: 'refused', replyState: 'sent' })
  })
})

describe('limits and the reply window', () => {
  async function priorJobs(recipientId: number, userId: number, n: number, costUsd = 0) {
    await db('wa_assistant_jobs').insert(Array.from({ length: n }, () => ({ wamid: `wamid.__prior_${++seq}`, recipientId, agencyId: A, userId, kind: 'text', messageTimestamp: Math.floor(Date.now() / 1000), status: 'answered', costUsd })))
  }

  it('per sender per hour: the first message over the limit is told, the next is silent', async () => {
    const o = await owner('972500006020')
    await priorJobs(o.r, o.u, 20)
    await ask('972500006020', 'עוד שאלה')
    await ask('972500006020', 'ועוד אחת')
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(h.sendText.mock.calls[0][0].body).toBe(COPY.senderLimit)
  })

  it('durable daily spend per agency', async () => {
    const o = await owner('972500006021')
    await priorJobs(o.r, o.u, 1, 2.5)
    await ask('972500006021', 'סכם לי את היום')
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText.mock.calls[0][0].body).toBe(COPY.agencyLimit)
  })

  it('past the reply window: expired, nothing sent', async () => {
    await owner('972500006022')
    const w = await ask('972500006022', 'סכם לי את היום', { at: Date.now() - 23.5 * 60 * 60 * 1000 })
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText).not.toHaveBeenCalled()
    expect(await job(w)).toMatchObject({ status: 'expired', replyState: 'skipped' })
  })
})

describe('failures are honest and final', () => {
  it('an Agent deadline gets the timeout copy', async () => {
    await owner('972500006030')
    await ask('972500006030', 'סכם לי את היום')
    const h = harness({ ok: false, reason: 'deadline', message: 'deadline', investigationId: 'inv', costUsd: 0 })
    await runWaAssistantWorker({}, h.deps)
    expect(h.sendText.mock.calls[0][0].body).toBe(COPY.timeout)
  })

  it('an unknown send outcome is recorded and never resent', async () => {
    await owner('972500006031')
    const w = await ask('972500006031', 'סכם לי את היום')
    const h = harness()
    h.sendText.mockResolvedValueOnce({ kind: 'unknown', reason: 'timeout' } as never)
    await runWaAssistantWorker({}, h.deps)
    await runWaAssistantWorker({}, h.deps)
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(await job(w)).toMatchObject({ replyState: 'unknown' })
  })

  it('an interrupted job (lease expired mid-send) becomes failed/unknown and is never re-run', async () => {
    await owner('972500006032')
    const w = await ask('972500006032', 'סכם לי את היום')
    await db('wa_assistant_jobs').where({ wamid: w }).update({ status: 'running', replyState: 'sending', lockedAt: new Date(Date.now() - 10 * 60 * 1000) })
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(await job(w)).toMatchObject({ status: 'failed', replyState: 'unknown', stopReason: 'lease_expired' })
    expect(h.sendText).not.toHaveBeenCalled()
  })

  it('media gets the "text only" note, without a model call', async () => {
    await owner('972500006033')
    await ask('972500006033', '', { type: 'audio' })
    const h = harness()
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.sendText.mock.calls[0][0].body).toBe(COPY.unsupported)
  })
})

describe('memory and audit', () => {
  it('text older than 24 hours is cleared; the ledger row stays', async () => {
    const o = await owner('972500006040')
    await db('wa_assistant_jobs').insert({ wamid: 'wamid.__old', recipientId: o.r, agencyId: A, userId: o.u, kind: 'text', question: 'ישן', answerHeadline: 'ישן', messageTimestamp: 1, status: 'answered', createdAt: new Date(Date.now() - 2 * DAY) })
    await runWaAssistantWorker({}, harness().deps)
    expect(await db('wa_assistant_jobs').where({ wamid: 'wamid.__old' }).first('question', 'answerHeadline', 'status')).toEqual({ question: null, answerHeadline: null, status: 'answered' })
  })

  it('every turn is audited with ids and outcomes only', async () => {
    await owner('972500006041')
    await ask('972500006041', 'סכם לי את היום')
    await runWaAssistantWorker({}, harness().deps)
    const [ev] = await db('analytics_events').where({ event: 'wa_assistant_turn' })
    expect(ev.props).toMatchObject({ status: 'answered', replyState: 'sent', costUsd: 0.01 })
    expect(JSON.stringify(ev.props)).not.toMatch(/סכם|972500006041|דניאל/)
  })

  it('without the platform number or token the worker does nothing', async () => {
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
    expect((await runWaAssistantWorker({}, harness().deps)).disabled).toBe(true)
  })
})
