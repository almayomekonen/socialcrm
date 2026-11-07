import { describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { enqueueAutoResponse } from '@/db/autoResponseJobs'
import { findOrCreateConversation } from '@/db/inboxConversations'
import { recordInboundOptOutCommand } from '@/db/whatsappOptOuts'
import { skipPendingAutomatedRepliesForCustomer } from '@/db/optOutPendingJobs'
import { drain, graphCalls, jobs, makeTenant, optedOut, resetGraphCalls, says, useOptOutHarness, type Tenant } from './pathsHarness'

/**
 * Phase 0 Item 3 follow-ups, end to end over the real schema (Meta stubbed):
 *  - an opt-out command is stored in the conversation but creates NO AI job;
 *  - saving an opt-out ends the customer's PENDING automated replies, scoped to
 *    this business and this number, and a cancellation failure never undoes it;
 *  - the send gate still blocks whatever the cancellation did not reach.
 */

useOptOutHarness()

const inbound = (t: Tenant) =>
  db('inbox_messages')
    .where({ agencyId: t.agencyId, direction: 'inbound' })
    .orderBy('id')
    .select('text', 'sequence', 'conversationId')
    .then((rows) => rows.map((r) => ({ ...r, sequence: Number(r.sequence) })))
const sentTo = (wa: string) => graphCalls.filter((c) => c.to === wa).length

/** A second customer (own lead, own number) at the same business. */
async function otherCustomer(t: Tenant, suffix: string) {
  const wa = `97253${String(t.agencyId).padStart(5, '0')}${suffix}`
  const [c] = await db('clients')
    .insert({ firstName: 'רון', lastName: 'לוי', phone: wa, agencyId: t.agencyId, userId: t.userId, handlerId: t.userId, createdById: t.userId, status: 'new' })
    .returning('id')
  return { ...t, leadId: Number(c.id), customerWaId: wa }
}

async function pendingJobFor(agencyId: number, conversationId: number, leadId: number | null) {
  return db.transaction((trx) =>
    enqueueAutoResponse(trx, { agencyId, conversationId, leadId, channel: 'whatsapp', triggerSequence: 1, reason: 'qualify_turn', delaySeconds: 0 }),
  )
}

describe('an opt-out command is stored but creates no AI work', () => {
  it.each([
    ['qualify legacy', 'qualify', ''],
    ['qualify reliability', 'qualify', 'all'],
    ['acknowledge', 'acknowledge', ''],
  ] as const)('%s: "עצור" as the first message of a NEW conversation', async (_name, mode, reliability) => {
    process.env.AGENT_RELIABILITY_AGENCY_IDS = reliability
    const t = await makeTenant(`first-${_name.replace(' ', '-')}`, { mode })
    const r = await says(t, 'עצור')
    expect(r).toMatchObject({ inserted: true, ireEnqueued: false, autoResponseDelaySeconds: 0 })
    expect(await optedOut(t)).toBe(true)
    expect(await inbound(t)).toMatchObject([{ text: 'עצור', sequence: 1 }]) // kept in history
    expect(await jobs(t)).toEqual([])
    await drain()
    expect(sentTo(t.customerWaId)).toBe(0) // no reply, no confirmation (D3)
  })

  it('AI disabled: recorded and stored, no job', async () => {
    const t = await makeTenant('ai-off-q', { aiEnabled: false })
    await says(t, 'STOP')
    expect(await optedOut(t)).toBe(true)
    expect(await inbound(t)).toHaveLength(1)
    expect(await jobs(t)).toEqual([])
  })

  it('a redelivered command is one message, one event, still no job', async () => {
    const t = await makeTenant('redeliver')
    const first = await says(t, 'הסר אותי', undefined, { id: 'wamid.in.redeliver-1' })
    const again = await says(t, 'הסר אותי', undefined, { id: 'wamid.in.redeliver-1' })
    expect(again).toMatchObject({ inserted: false, messageId: first.messageId, ireEnqueued: false })
    expect(await inbound(t)).toHaveLength(1)
    expect(await db('whatsapp_opt_out_events').where({ agencyId: t.agencyId }).count<{ n: string }[]>('id as n')).toEqual([{ n: '1' }])
    expect(await jobs(t)).toEqual([])
  })

  it('ordering is kept: the earlier question is cancelled, a later ordinary message is blocked at send', async () => {
    const t = await makeTenant('order')
    await says(t, 'כמה עולה צילום חתונה?')
    expect(await jobs(t)).toMatchObject([{ reason: 'qualify_turn', status: 'pending' }])
    await says(t, 'עצור')
    expect(await jobs(t)).toMatchObject([{ status: 'skipped', skipReason: 'opted_out' }]) // cancelled at record time
    await says(t, 'אגב, כמה זה עולה לאירוע של 200 איש?') // not a command: queued as before…
    await drain()
    expect(sentTo(t.customerWaId)).toBe(0) // …and refused by the gate
    expect((await inbound(t)).map((m) => [m.text, m.sequence])).toEqual([
      ['כמה עולה צילום חתונה?', 1],
      ['עצור', 2],
      ['אגב, כמה זה עולה לאירוע של 200 איש?', 3],
    ])
    expect((await jobs(t)).at(-1)).toMatchObject({ status: 'skipped', skipReason: 'opted_out' })
  })

  it('another customer of the same business is answered as before', async () => {
    const t = await makeTenant('neighbour', { mode: 'acknowledge' })
    const n = await otherCustomer(t, '01')
    await says(t, 'עצור')
    await says(n, 'שלום, אפשר פרטים?')
    resetGraphCalls()
    await drain()
    expect(sentTo(n.customerWaId)).toBe(1)
    expect(sentTo(t.customerWaId)).toBe(0)
  })
})

describe('saving an opt-out ends pending automated replies, and only those', () => {
  it('pending reply on another conversation of this customer is skipped; neighbours and other businesses untouched', async () => {
    const shared = `97252${String(Date.now() % 10_000_000).padStart(7, '0')}`
    const t = await makeTenant('cancel', { customerWaId: shared })
    const elsewhere = await makeTenant('cancel-other-biz', { customerWaId: shared })
    const n = await otherCustomer(t, '02')
    await says(t, 'שלום') // pending job, conversation on number 1
    await says(n, 'שלום') // neighbour's pending job
    await says(elsewhere, 'שלום') // same number, other business
    const r = await says(t, 'STOP', t.secondNumberId) // opt-out on number 2
    expect(r.ireEnqueued).toBe(false)
    expect(await jobs(t)).toMatchObject([
      { status: 'skipped', skipReason: 'opted_out' },
      { status: 'pending' }, // the neighbour's
    ])
    expect(await jobs(elsewhere)).toMatchObject([{ status: 'pending' }])
    resetGraphCalls()
    await drain()
    expect(graphCalls.filter((c) => c.to === shared)).toHaveLength(1) // only the other business answered
    expect(sentTo(n.customerWaId)).toBe(1)
  })

  it('a job already being processed is left to its worker, whose send the gate then refuses', async () => {
    const t = await makeTenant('processing')
    await says(t, 'שלום')
    await db('auto_response_jobs').where({ agencyId: t.agencyId }).update({ status: 'processing', lockedAt: db.fn.now(), lockedBy: 'other-worker' })
    await says(t, 'עצור', t.secondNumberId)
    expect(await jobs(t)).toMatchObject([{ status: 'processing' }])
    await db('auto_response_jobs').where({ agencyId: t.agencyId }).update({ status: 'skipped', skipReason: 'test_cleanup' })
  })

  it('a failed cancellation never undoes the opt-out; the gate still blocks the pending job', async () => {
    const t = await makeTenant('cancel-fails')
    await says(t, 'שלום')
    const res = await recordInboundOptOutCommand(
      { agencyId: t.agencyId, customerPhoneE164: `+${t.customerWaId}`, command: 'opt_out', eventAt: new Date(), messageExternalId: 'wamid.in.cf-1' },
      {
        skipPendingJobs: async (sp) => {
          await sp('auto_response_jobs').where({ agencyId: t.agencyId }).update({ skipReason: 'half-written' })
          throw new Error('simulated cancellation failure')
        },
      },
    )
    expect(res).toMatchObject({ outcome: 'applied', skippedPendingJobs: null })
    expect(await optedOut(t)).toBe(true)
    expect(await jobs(t)).toMatchObject([{ status: 'pending', skipReason: null }]) // savepoint rolled back
    resetGraphCalls()
    await drain()
    expect(sentTo(t.customerWaId)).toBe(0)
    expect(await jobs(t)).toMatchObject([{ status: 'skipped', skipReason: 'opted_out' }])
  })

  it('a stale opt-out (older than a later re-opt-in) cancels nothing', async () => {
    const t = await makeTenant('stale')
    const phone = `+${t.customerWaId}`
    const at = (s: number) => new Date(Date.now() - 3_600_000 + s * 1000)
    await recordInboundOptOutCommand({ agencyId: t.agencyId, customerPhoneE164: phone, command: 'opt_out', eventAt: at(10), messageExternalId: 'wamid.st-1' })
    await recordInboundOptOutCommand({ agencyId: t.agencyId, customerPhoneE164: phone, command: 'opt_in', eventAt: at(30), messageExternalId: 'wamid.st-2' })
    await says(t, 'שלום')
    const res = await recordInboundOptOutCommand({ agencyId: t.agencyId, customerPhoneE164: phone, command: 'opt_out', eventAt: at(20), messageExternalId: 'wamid.st-3' })
    expect(res).toMatchObject({ outcome: 'stale', skippedPendingJobs: 0 })
    expect(await jobs(t)).toMatchObject([{ status: 'pending' }])
    await db('auto_response_jobs').where({ agencyId: t.agencyId }).update({ status: 'skipped', skipReason: 'test_cleanup' })
  })
})

describe('skipPendingAutomatedRepliesForCustomer — number matching', () => {
  it('matches the wa_id and the local spelling of a rep-started conversation; never a near miss or another business', async () => {
    const t = await makeTenant('spell')
    const other = await makeTenant('spell-other')
    const digits = t.customerWaId // 97254XXXXXXX
    const conv = (agencyId: number, pn: string, wa: string) =>
      db.transaction((trx) =>
        findOrCreateConversation(trx, { agencyId, leadId: null, channel: 'whatsapp', businessPhoneNumberId: pn, customerWaId: wa, customerName: null }),
      )
    const metaId = await conv(t.agencyId, t.phoneNumberId, digits)
    const localId = await conv(t.agencyId, t.secondNumberId, `0${digits.slice(3)}`)
    const nearId = await conv(t.agencyId, `${t.phoneNumberId}-x`, digits.slice(0, -1) + (digits.endsWith('9') ? '8' : '9'))
    const foreignId = await conv(other.agencyId, other.phoneNumberId, digits)
    for (const [agencyId, id] of [[t.agencyId, metaId], [t.agencyId, localId], [t.agencyId, nearId], [other.agencyId, foreignId]]) {
      await pendingJobFor(agencyId, id, null)
    }
    const n = await db.transaction((trx) => skipPendingAutomatedRepliesForCustomer(trx, t.agencyId, `+${digits}`))
    expect(n).toBe(2)
    const status = async (id: number) => (await db('auto_response_jobs').where({ conversationId: id }).first('status')).status
    expect([await status(metaId), await status(localId), await status(nearId), await status(foreignId)]).toEqual(['skipped', 'skipped', 'pending', 'pending'])
    await db('auto_response_jobs').whereIn('conversationId', [nearId, foreignId]).update({ status: 'skipped', skipReason: 'test_cleanup' })
  })
})
