import { describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { failAutoResponseJob } from '@/db/autoResponseJobs'
import { AUTOMATED_SEND_TIMEOUT_MS } from '@/lib/whatsapp/sendOutcome'
import { drain, graphCalls, jobs, makeTenant, outbound, says, useOptOutHarness, type Tenant } from './optOut/pathsHarness'

/**
 * An automated reply whose send outcome is UNKNOWN must never be sent again
 * automatically — not by a retry, not by a reclaim, not by a late reset, and not
 * by the customer's next message. Real ingest, real workers, real gated send
 * primitives; only Meta (`fetch`) is stubbed. Synthetic tenants, nothing sent.
 */

useOptOutHarness()

/** Meta's side: the request arrives, then the connection drops before an answer. */
function metaDropsTheConnection() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      graphCalls.push({ to: body.to, type: body.type })
      throw new TypeError('fetch failed')
    }),
  )
}

/** Meta refuses with a Graph error body: an answer, nothing delivered. */
function metaRefuses() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      graphCalls.push({ to: body.to, type: body.type })
      return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid parameter', code: 100 } }), headers: { get: () => null } }
    }),
  )
}

/** Meta accepts, and records the abort signal each send carried. */
const signals: Array<AbortSignal | null | undefined> = []
function metaAccepts() {
  signals.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      graphCalls.push({ to: body.to, type: body.type })
      signals.push(init.signal)
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.out.${Math.random().toString(36).slice(2)}` }] }), headers: { get: () => null } }
    }),
  )
}

const makeDue = (t: Tenant) => db('auto_response_jobs').where({ agencyId: t.agencyId, status: 'pending' }).update({ notBefore: db.fn.now() })
const aiState = async (t: Tenant) =>
  (await db('conversation_ai_state').where({ agencyId: t.agencyId }).first('aiState', 'escalationReason')) ?? null
const sends = (t: Tenant) => graphCalls.filter((c) => c.to === t.customerWaId).length

async function retryEverything(t: Tenant) {
  await makeDue(t)
  await db('auto_response_jobs').where({ agencyId: t.agencyId, status: 'processing' }).update({ lockedAt: new Date(Date.now() - 10 * 60_000) })
  await drain()
}

describe('an ambiguous automated send is never sent twice', () => {
  it('acknowledge mode: parked, handed to a person, never retried, and the next message gets no second acknowledgement', async () => {
    const t = await makeTenant('amb-ack', { mode: 'acknowledge', replyMode: 'fixed' })
    metaDropsTheConnection()
    await says(t, 'היי, אשמח לפרטים')
    await drain()

    expect(sends(t)).toBe(1)
    expect(await jobs(t)).toEqual([{ reason: 'first_contact', status: 'skipped', skipReason: 'send_outcome_unknown' }])
    expect(await aiState(t)).toMatchObject({ aiState: 'escalated', escalationReason: 'send_outcome_unknown' })
    // Nothing is written to the thread: we do not know that it arrived.
    expect(Number((await outbound(t))[0].n)).toBe(0)

    metaAccepts()
    await retryEverything(t)
    expect(sends(t)).toBe(1)

    // The customer writes again: the acknowledgement may already be on their phone.
    await says(t, 'שלום?')
    await drain()
    expect(sends(t)).toBe(1)
  })

  it('qualify mode (AI turn): parked and escalated, so no regenerated reply follows', async () => {
    const t = await makeTenant('amb-qual', { mode: 'qualify' })
    metaDropsTheConnection()
    await says(t, 'כמה זה עולה?')
    await drain()
    expect(sends(t)).toBe(1)
    expect((await jobs(t))[0]).toMatchObject({ status: 'skipped', skipReason: 'send_outcome_unknown' })

    metaAccepts()
    await retryEverything(t)
    await says(t, 'הלו?')
    await drain()
    expect(sends(t)).toBe(1)
  })

  it('a late reset by any caller cannot put the parked job back in the queue', async () => {
    const t = await makeTenant('amb-late', { mode: 'acknowledge', replyMode: 'fixed' })
    metaDropsTheConnection()
    await says(t, 'היי')
    await drain()
    const [row] = await db('auto_response_jobs').where({ agencyId: t.agencyId }).select('id')
    await failAutoResponseJob(Number(row.id), 'late caller')
    expect(await jobs(t)).toEqual([{ reason: 'first_contact', status: 'skipped', skipReason: 'send_outcome_unknown' }])
  })

  it('questionnaire: still parked for review exactly as before, one send, no retry', async () => {
    const t = await makeTenant('amb-q', { responder: 'questionnaire' })
    metaDropsTheConnection()
    await says(t, 'היי, אני מתחתנת בקיץ')
    await drain()
    expect(sends(t)).toBe(1)
    expect((await jobs(t))[0]).toMatchObject({ status: 'skipped', skipReason: 'send_ambiguous_parked' })
    const session = await db('questionnaire_sessions').where({ agencyId: t.agencyId }).first('status', 'endedReason')
    expect(session).toMatchObject({ status: 'needs_review', endedReason: 'send_outcome_unknown' })

    metaAccepts()
    await retryEverything(t)
    expect(sends(t)).toBe(1)
  })
})

describe('definite failures and the timeout', () => {
  it('a definite Graph refusal (nothing delivered) is still retried, and is not handed to a person', async () => {
    const t = await makeTenant('def-ack', { mode: 'acknowledge', replyMode: 'fixed' })
    metaRefuses()
    await says(t, 'היי')
    await drain()
    expect(await jobs(t)).toEqual([{ reason: 'first_contact', status: 'pending', skipReason: null }])
    expect((await aiState(t))?.aiState ?? null).not.toBe('escalated')

    metaAccepts()
    await makeDue(t)
    await drain()
    expect((await jobs(t))[0]).toMatchObject({ status: 'sent' })
  })

  it('the acknowledge send carries a bounded timeout', async () => {
    const t = await makeTenant('timeout-ack', { mode: 'acknowledge', replyMode: 'fixed' })
    metaAccepts()
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await says(t, 'היי')
    await drain()
    expect(sends(t)).toBe(1)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(timeout).toHaveBeenCalledWith(AUTOMATED_SEND_TIMEOUT_MS)
    timeout.mockRestore()
  })
})
