import { describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { scheduleNoResponseWarning } from '@/lib/inbox/autoresponse/processNoResponseJob'
import { whatsappExecutor } from '@/lib/automations/executors/whatsapp'
import { isExecutionSkippedError } from '@/lib/automations/executors/types'
import { drain, graphCalls, jobs, makeTenant, optedOut, outbound, resetGraphCalls, says, useOptOutHarness } from './pathsHarness'

/**
 * Phase 0 Item 3, end to end: a customer's "עצור" reaches the store through the
 * real inbound ingest, and every automated path then runs its REAL send code —
 * the gated primitives — against a stubbed Meta. Nothing here sends anything.
 *
 * Paths: acknowledge (AI reply and fixed reply), qualify (legacy and the
 * reliability mode), questionnaire, scheduled no-response follow-up, the
 * automations engine, AI disabled, a new conversation, agency isolation and
 * re-opt-in.
 */

useOptOutHarness()

describe('acknowledge mode (it never checked opt-out before)', () => {
  it.each(['ai', 'fixed'] as const)('replyMode %s: "עצור" gets no reply and creates no AI job at all', async (replyMode) => {
    const t = await makeTenant(`ack-${replyMode}`, { mode: 'acknowledge', replyMode })
    await says(t, 'עצור')
    expect(await optedOut(t)).toBe(true)
    expect(await jobs(t)).toEqual([]) // nothing to generate, so nothing to block
    await drain()
    expect(graphCalls).toHaveLength(0)
    expect(Number((await outbound(t))[0].n)).toBe(0) // no failed-message bubble either
  })

  it('control: an ordinary first message in acknowledge mode IS answered through the same path', async () => {
    const t = await makeTenant('ack-control', { mode: 'acknowledge' })
    await says(t, 'שלום, אפשר פרטים?')
    await drain()
    expect(graphCalls).toHaveLength(1)
  })
})

describe('qualify agent, both modes: a NEW conversation from an opted-out customer is not answered', () => {
  it.each([
    ['legacy', ''],
    ['reliability', 'all'],
  ])('%s', async (_name, reliability) => {
    process.env.AGENT_RELIABILITY_AGENCY_IDS = reliability
    const t = await makeTenant(`q-${_name}`)
    // Opt out on the business's SECOND number…
    await says(t, 'STOP', t.secondNumberId)
    await drain()
    resetGraphCalls()
    // …then write to the first number: a different, brand-new conversation.
    await says(t, 'שלום, כמה עולה צילום חתונה?')
    await drain()
    expect(graphCalls).toHaveLength(0)
    const last = (await jobs(t)).at(-1)
    expect(last).toMatchObject({ status: 'skipped', skipReason: 'opted_out' })
  })
})

describe('questionnaire responder', () => {
  it('an opted-out customer starting a conversation gets no question', async () => {
    const t = await makeTenant('qn', { responder: 'questionnaire', mode: 'acknowledge' })
    await says(t, 'הסר אותי', t.secondNumberId)
    await drain()
    resetGraphCalls()
    await says(t, 'היי')
    await drain()
    expect(graphCalls).toHaveLength(0)
    expect(await optedOut(t)).toBe(true)
  })

  it('control: the same responder asks its first question when not opted out', async () => {
    const t = await makeTenant('qn-control', { responder: 'questionnaire', mode: 'acknowledge' })
    await says(t, 'היי')
    await drain()
    expect(graphCalls.length).toBeGreaterThan(0)
  })
})

describe('a scheduled follow-up created before the opt-out', () => {
  it('the no-response warning is not sent and ends as an opted_out skip', async () => {
    const t = await makeTenant('noresp')
    await says(t, 'שלום, אני מחפשת צלם')
    await drain()
    expect(graphCalls).toHaveLength(1) // the agent replied
    const conv = await db('inbox_conversations').where({ agencyId: t.agencyId, businessPhoneNumberId: t.phoneNumberId }).first('id')
    const existing = await db('auto_response_jobs').where({ agencyId: t.agencyId, reason: 'no_response_warning' }).first('id')
    if (!existing) {
      const seqRow = await db('inbox_messages').where({ conversationId: conv.id }).max<{ m: number }[]>('sequence as m')
      await scheduleNoResponseWarning({ agencyId: t.agencyId, conversationId: conv.id, leadId: t.leadId, channel: 'whatsapp', triggerSequence: Number(seqRow[0].m) })
    }
    // The customer opts out on the other number — no inbound on THIS thread to supersede the job.
    await says(t, 'unsubscribe', t.secondNumberId)
    await db('auto_response_jobs').where({ agencyId: t.agencyId, reason: 'no_response_warning', status: 'pending' }).update({ notBefore: db.raw("now() - interval '1 minute'") })
    resetGraphCalls()
    await drain()
    expect(graphCalls).toHaveLength(0)
    const warning = await db('auto_response_jobs').where({ agencyId: t.agencyId, reason: 'no_response_warning' }).first('status', 'skipReason')
    expect(warning).toMatchObject({ status: 'skipped', skipReason: 'opted_out' })
  })
})

describe('AI disabled', () => {
  it('the opt-out is still recorded, and a later automation template is refused as a terminal skip', async () => {
    const t = await makeTenant('ai-off', { aiEnabled: false })
    await says(t, 'עצור')
    expect(await optedOut(t)).toBe(true)
    expect(await jobs(t)).toHaveLength(0)

    const deps = { ...whatsappExecutor.defaultDeps(), persist: vi.fn() }
    const err = await whatsappExecutor
      .execute(
        { agencyId: t.agencyId, automationId: 1, leadId: t.leadId, mode: 'live', subject: {} as never, recipients: [] as never, parameters: {} },
        {
          template: { id: 1, status: 'approved', name: 'tpl', language: 'he', category: 'UTILITY', bodyText: 'x', variables: [], bindings: [] },
          target: { businessPhoneNumberId: t.phoneNumberId, accessToken: 't', customerWaId: t.customerWaId, customerName: null, leadName: 'דנה' } as never,
          params: [],
          text: 'x',
        },
        deps,
      )
      .then(() => null, (e) => e)
    expect(isExecutionSkippedError(err)).toBe(true)
    expect((err as { reason: string }).reason).toBe('opted_out')
    expect(graphCalls).toHaveLength(0)
    expect(deps.persist).not.toHaveBeenCalled()
  })
})

describe('isolation and re-opt-in', () => {
  it('the same customer number at another business is still answered', async () => {
    const shared = `97258${String(Date.now() % 10_000_000).padStart(7, '0')}`
    const x = await makeTenant('iso-x', { mode: 'acknowledge', customerWaId: shared })
    const y = await makeTenant('iso-y', { mode: 'acknowledge', customerWaId: shared })
    await says(x, 'עצור')
    await says(y, 'שלום')
    await drain()
    expect(graphCalls).toEqual([{ to: shared, type: 'text' }]) // only business Y answered
    expect(await optedOut(x)).toBe(true)
    expect(await optedOut(y)).toBe(false)
  })

  it('after START the customer is answered again; an ordinary message never re-opts in', async () => {
    const t = await makeTenant('reoptin', { mode: 'acknowledge' })
    await says(t, 'עצור', t.secondNumberId)
    await says(t, 'שלום, אני רוצה לחזור לקבל הודעות')
    await drain()
    expect(graphCalls).toHaveLength(0)
    expect(await optedOut(t)).toBe(true)

    await says(t, 'START', t.secondNumberId)
    expect(await optedOut(t)).toBe(false)
    const events = await db('whatsapp_opt_out_events').where({ agencyId: t.agencyId }).orderBy('id').select('kind', 'outcome')
    expect(events).toEqual([
      { kind: 'opt_out', outcome: 'applied' },
      { kind: 'opt_in', outcome: 'applied' },
    ])
    await says(t, 'שלום שוב', t.secondNumberId)
    await drain()
    expect(graphCalls.length).toBeGreaterThan(0)
  })
})
