import { describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { claimAutoResponseJobs, reclaimStaleAutoResponseJobs, type AutoResponseJob } from '@/db/autoResponseJobs'
import { clearSendStarted, markSendStarted } from '@/db/autoResponseSendMarker'
import { fencedSend, LeaseLostError } from '@/lib/inbox/autoresponse/jobLease'
import { applyIreWhatsappSendFailure } from '@/lib/inbox/onWhatsappSendFailure'
import { sendWhatsappText, type SendWhatsappTextFailure } from '@/lib/whatsapp/sendMessage'
import { drain, graphCalls, makeTenant, says, useOptOutHarness, type Tenant } from './optOut/pathsHarness'

/**
 * PR3 — the AI auto-response crash window. A worker that sent a reply Meta
 * ACCEPTED, then died (or failed) before the outbound row was saved, must never
 * cause a second send. The durable marker (`sendStartedAt`, set by the lease
 * owner before the request) makes the reclaim and the failure path park the job
 * instead of re-queueing it. Real ingest, workers and gated send primitives;
 * only Meta (`fetch`) is stubbed. Synthetic tenants, nothing sent.
 */

const h = vi.hoisted(() => ({ persistThrows: false }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/persistOutboundWhatsapp')>()
  return {
    ...actual,
    persistOutboundWhatsapp: vi.fn(async (...a: Parameters<typeof actual.persistOutboundWhatsapp>) => {
      if (h.persistThrows) throw Object.assign(new Error('db write failed'), { name: 'DbDown' })
      return actual.persistOutboundWhatsapp(...a)
    }),
  }
})

useOptOutHarness()

function meta(answer: 'accept' | 'refuse') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      graphCalls.push({ to: body.to, type: body.type })
      return answer === 'accept'
        ? { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.out.${graphCalls.length}` }] }), headers: { get: () => null } }
        : { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid parameter', code: 100 } }), headers: { get: () => null } }
    }),
  )
}

const sends = (t: Tenant) => graphCalls.filter((c) => c.to === t.customerWaId).length
const jobRows = (t: Tenant) =>
  db('auto_response_jobs').where({ agencyId: t.agencyId }).orderBy('id').select('id', 'status', 'skipReason', 'lastError', 'sendStartedAt', 'lockedBy')
const aiState = async (t: Tenant) => (await db('conversation_ai_state').where({ agencyId: t.agencyId }).first('aiState', 'escalationReason')) ?? null
const expireLeases = (t: Tenant) =>
  db('auto_response_jobs').where({ agencyId: t.agencyId, status: 'processing' }).update({ lockedAt: new Date(Date.now() - 10 * 60_000) })
const makeDue = (t: Tenant) => db('auto_response_jobs').where({ agencyId: t.agencyId, status: 'pending' }).update({ notBefore: db.fn.now() })
const sendArgs = (t: Tenant) => ({
  phoneNumberId: t.phoneNumberId,
  accessToken: 't',
  to: t.customerWaId,
  body: 'תודה שפנית',
  consent: { kind: 'automated' as const, agencyId: t.agencyId },
})

describe('PR3: a reply Meta accepted is never sent again after a crash or a failed save', () => {
  it('1. crash after Meta accepted, before the outbound row: the reclaim parks it, escalates, and never resends', async () => {
    const t = await makeTenant('ss-crash', { mode: 'acknowledge', replyMode: 'fixed' })
    meta('accept')
    await says(t, 'היי')
    // A worker claims the job and sends through the real fence, then dies before persisting.
    const [claimed] = (await claimAutoResponseJobs('dying-worker', 10)).filter((j) => j.agencyId === t.agencyId)
    const sent = await fencedSend(sendWhatsappText, claimed.id, 'dying-worker')(sendArgs(t) as never)
    expect(sent).toMatchObject({ ok: true })
    expect(sends(t)).toBe(1)
    expect((await jobRows(t))[0].sendStartedAt).not.toBeNull()

    await expireLeases(t)
    await drain()
    expect(await jobRows(t)).toMatchObject([{ status: 'skipped', skipReason: 'send_outcome_unknown', lastError: 'lease-expired-after-send-started' }])
    expect(await aiState(t)).toMatchObject({ aiState: 'escalated', escalationReason: 'send_outcome_unknown' })

    await makeDue(t)
    await drain()
    await says(t, 'שלום?')
    await drain()
    expect(sends(t)).toBe(1)
  })

  it('2. the save throws after a successful send (qualify turn): parked, escalated, no retry', async () => {
    const t = await makeTenant('ss-persist', { mode: 'qualify' })
    meta('accept')
    h.persistThrows = true
    try {
      await says(t, 'כמה זה עולה?')
      await drain()
    } finally {
      h.persistThrows = false
    }
    expect(sends(t)).toBe(1)
    expect((await jobRows(t))[0]).toMatchObject({ status: 'skipped', skipReason: 'send_outcome_unknown' })
    expect(await aiState(t)).toMatchObject({ aiState: 'escalated' })

    await makeDue(t)
    await expireLeases(t)
    await drain()
    expect(sends(t)).toBe(1)
  })

  it('3. a definite Meta refusal clears the marker and keeps the retry, and the retry sends', async () => {
    const t = await makeTenant('ss-refuse', { mode: 'acknowledge', replyMode: 'fixed' })
    meta('refuse')
    await says(t, 'היי')
    await drain()
    expect(await jobRows(t)).toMatchObject([{ status: 'pending', skipReason: null, sendStartedAt: null }])
    expect((await aiState(t))?.aiState ?? null).not.toBe('escalated')

    meta('accept')
    await makeDue(t)
    await drain()
    expect((await jobRows(t))[0]).toMatchObject({ status: 'sent' })
    expect(sends(t)).toBe(2) // one refused by Meta, one delivered
  })

  it('4. a worker that lost its lease can neither mark, send, nor clear the new owner’s marker', async () => {
    const t = await makeTenant('ss-lease', { mode: 'acknowledge', replyMode: 'fixed' })
    meta('accept')
    await says(t, 'היי')
    const [claimed] = (await claimAutoResponseJobs('w-old', 10)).filter((j) => j.agencyId === t.agencyId)
    // The lease moved to a newer worker.
    await db('auto_response_jobs').where({ id: claimed.id }).update({ lockedBy: 'w-new' })

    const send = vi.fn(sendWhatsappText)
    await expect(fencedSend(send, claimed.id, 'w-old')(sendArgs(t) as never)).rejects.toBeInstanceOf(LeaseLostError)
    expect(send).not.toHaveBeenCalled()
    expect((await jobRows(t))[0].sendStartedAt).toBeNull()

    expect(await markSendStarted(claimed.id, 'w-new')).toBe(true)
    expect(await clearSendStarted(claimed.id, 'w-old')).toBe(false)
    expect((await jobRows(t))[0].sendStartedAt).not.toBeNull()

    // Lost DURING a refused send: the stale worker stops and leaves the new owner's state alone.
    await db('auto_response_jobs').where({ id: claimed.id }).update({ lockedBy: 'w-old', sendStartedAt: null })
    const refusedThenLost = vi.fn(async () => {
      await db('auto_response_jobs').where({ id: claimed.id }).update({ lockedBy: 'w-new', sendStartedAt: db.fn.now() })
      return { ok: false as const, error: 'Invalid parameter', code: '100', httpStatus: 400 }
    })
    await expect(fencedSend(refusedThenLost, claimed.id, 'w-old')({} as never)).rejects.toBeInstanceOf(LeaseLostError)
    expect((await jobRows(t))[0]).toMatchObject({ status: 'processing', lockedBy: 'w-new' })
    expect((await jobRows(t))[0].sendStartedAt).not.toBeNull()
    expect(sends(t)).toBe(0)
  })

  it('5. unchanged: the happy path sends once and completes; the questionnaire turn is not marked and still sends', async () => {
    const ack = await makeTenant('ss-happy', { mode: 'acknowledge', replyMode: 'fixed' })
    const q = await makeTenant('ss-quest', { responder: 'questionnaire' })
    meta('accept')
    await says(ack, 'היי')
    await says(q, 'היי, אני מתחתנת בקיץ')
    await drain()

    expect(sends(ack)).toBe(1)
    const [a] = await jobRows(ack)
    expect(a.status).toBe('sent')
    expect(a.sendStartedAt).not.toBeNull()

    expect(sends(q)).toBe(1)
    const [qj] = await jobRows(q)
    expect(qj.status).toBe('sent')
    expect(qj.sendStartedAt).toBeNull()
  })

  /**
   * A owns the job, Meta definitely refuses, A clears its marker, then stalls past
   * its lease. The job is reclaimed, claimed and marked by B. A resumes and runs
   * the failure handler with its own (now stale) ownership.
   */
  async function staleOwnerAfterRefusal(slug: string, refusal: SendWhatsappTextFailure) {
    const t = await makeTenant(slug, { mode: 'acknowledge', replyMode: 'fixed' })
    await says(t, 'היי')
    const [a] = (await claimAutoResponseJobs('w-A', 10)).filter((j) => j.agencyId === t.agencyId)
    const sent = await fencedSend(vi.fn(async () => refusal), a.id, 'w-A')(sendArgs(t) as never)
    expect(sent).toMatchObject({ ok: false })
    expect((await jobRows(t))[0]).toMatchObject({ status: 'processing', lockedBy: 'w-A', sendStartedAt: null })

    await expireLeases(t)
    await reclaimStaleAutoResponseJobs(60_000)
    await makeDue(t)
    const [b] = (await claimAutoResponseJobs('w-B', 10)).filter((j) => j.agencyId === t.agencyId)
    expect(b.id).toBe(a.id)
    expect(await markSendStarted(b.id, 'w-B')).toBe(true)
    const ctx = { businessPhoneNumberId: t.phoneNumberId, customerWaId: t.customerWaId, customerName: null, sentByUserId: null, text: 'תודה שפנית' }
    const fail = (job: AutoResponseJob, owner: string) => applyIreWhatsappSendFailure({ ...job, ownerWorkerId: owner }, refusal, ctx)
    return { t, a, b, fail }
  }

  async function expectUntouchedByA(t: Tenant, before: Record<string, unknown>) {
    const [row] = await jobRows(t)
    expect(row).toMatchObject({ status: 'processing', lockedBy: 'w-B', skipReason: null, lastError: before.lastError })
    expect(row.sendStartedAt).not.toBeNull()
    expect(row.sendStartedAt).toEqual(before.sendStartedAt)
    expect((await aiState(t))?.aiState ?? null).not.toBe('escalated')
  }

  it('6. a stale worker’s refusal handling cannot reset, park or unlock the new owner’s job; the owner still retries', async () => {
    const refusal = { ok: false as const, error: 'Invalid parameter', code: '100', httpStatus: 400 }
    const { t, a, b, fail } = await staleOwnerAfterRefusal('ss-stale-fail', refusal)
    const [before] = await jobRows(t)

    await fail(a, 'w-A')
    await expectUntouchedByA(t, before)

    // The legitimate owner's own definite refusal: marker cleared by its fence, then the ordinary retry.
    expect(await clearSendStarted(b.id, 'w-B')).toBe(true)
    await fail(b, 'w-B')
    expect((await jobRows(t))[0]).toMatchObject({ status: 'pending', lockedBy: null, skipReason: null, sendStartedAt: null })
    expect((await jobRows(t))[0].lastError).toContain('Invalid parameter')
    expect(sends(t)).toBe(0)
  })

  it('7. a stale worker’s account-level dead-letter leaves the new owner’s job alone; the owner still dead-letters', async () => {
    const refusal = { ok: false as const, error: 'Account restricted', code: '131031', httpStatus: 400 }
    const { t, a, b, fail } = await staleOwnerAfterRefusal('ss-stale-dead', refusal)
    const [before] = await jobRows(t)

    expect(await fail(a, 'w-A')).toMatchObject({ category: 'account' })
    await expectUntouchedByA(t, before)

    expect(await clearSendStarted(b.id, 'w-B')).toBe(true)
    await fail(b, 'w-B')
    expect((await jobRows(t))[0]).toMatchObject({ status: 'dead', lockedBy: null })
    expect((await jobRows(t))[0].lastError).toContain('Account restricted')
    expect(sends(t)).toBe(0)
  })
})
