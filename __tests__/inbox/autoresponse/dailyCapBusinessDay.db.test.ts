import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { countSentToday } from '@/db/autoResponseJobs'

/**
 * The daily cap counts auto-replies sent since the start of the ISRAEL business
 * day — not the database's day. Around Israel midnight, in winter (UTC+2) and
 * summer (UTC+3), and whatever TimeZone the database session runs in.
 *
 * Before the fix the boundary was `date_trunc('day', now())`: on a UTC database
 * the cap reset at 02:00 (winter) / 03:00 (summer) Israel time, and replies sent
 * between Israel midnight and then were still charged to the previous day.
 */

const Z = (iso: string) => new Date(iso).getTime()
let agencyId = 0
let otherAgencyId = 0
let conversationId = 0
let otherConversationId = 0

async function agencyWithConversation(name: string): Promise<{ agencyId: number; conversationId: number }> {
  const [a] = await db('agencies').insert({ name, plan: 'pro' }).returning('id')
  const id = Number(a.id)
  const [c] = await db('inbox_conversations')
    .insert({ agencyId: id, leadId: null, channel: 'whatsapp', businessPhoneNumberId: `cap_pn_${id}`, customerWaId: `97250${String(id).padStart(7, '0')}`, customerName: 'דני' })
    .returning('id')
  return { agencyId: id, conversationId: Number(c.id) }
}

/** One auto_response_jobs row for the agency, finished at `updatedAt`. */
async function job(updatedAt: string, opts: { agency?: 'mine' | 'other'; status?: string; reason?: string } = {}) {
  const mine = (opts.agency ?? 'mine') === 'mine'
  await db('auto_response_jobs').insert({
    agencyId: mine ? agencyId : otherAgencyId,
    conversationId: mine ? conversationId : otherConversationId,
    channel: 'whatsapp',
    reason: opts.reason ?? 'qualify_turn',
    triggerSequence: 1,
    status: opts.status ?? 'sent',
    createdAt: updatedAt,
    updatedAt,
  })
}
const clear = () => db('auto_response_jobs').whereIn('agencyId', [agencyId, otherAgencyId]).del()

/** countSentToday inside a transaction whose session runs in `tz`. */
async function countIn(tz: string, nowMs: number): Promise<number> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL TIME ZONE '${tz}'`)
    return countSentToday(agencyId, nowMs, trx)
  })
}
const SESSION_ZONES = ['UTC', 'Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Kiritimati']

beforeAll(async () => {
  ;({ agencyId, conversationId } = await agencyWithConversation('cap-business-day'))
  ;({ agencyId: otherAgencyId, conversationId: otherConversationId } = await agencyWithConversation('cap-business-day-other'))
})

afterAll(async () => {
  await clear()
  await db('inbox_conversations').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('agencies').whereIn('id', [agencyId, otherAgencyId]).del()
  await db.destroy()
})

describe('winter (Israel = UTC+2): the business day starts at 22:00Z the evening before', () => {
  // 2026-01-15 00:00 Israel = 2026-01-14T22:00:00Z
  it('a reply at 23:59 Israel belongs to yesterday; one at 00:00 and one at 00:10 belong to today', async () => {
    await clear()
    await job('2026-01-14T21:59:59Z') // 23:59:59 Israel, Jan 14
    await job('2026-01-14T22:00:00Z') // 00:00:00 Israel, Jan 15
    await job('2026-01-14T22:10:00Z') // 00:10 Israel, Jan 15
    const now = Z('2026-01-14T22:30:00Z') // 00:30 Israel, Jan 15 — still Jan 14 in UTC
    for (const tz of SESSION_ZONES) expect(await countIn(tz, now), tz).toBe(2)
    expect(await countSentToday(agencyId, now)).toBe(2)
  })

  it('at 02:30 Israel (just after UTC midnight) the replies since Israel midnight still count', async () => {
    await clear()
    await job('2026-01-14T23:00:00Z') // 01:00 Israel, Jan 15 — a UTC day boundary sits between it and now
    await job('2026-01-15T00:15:00Z') // 02:15 Israel, Jan 15
    const now = Z('2026-01-15T00:30:00Z') // 02:30 Israel, Jan 15
    for (const tz of SESSION_ZONES) expect(await countIn(tz, now), tz).toBe(2)
  })

  it('just before Israel midnight, the whole Israel day so far counts', async () => {
    await clear()
    await job('2026-01-14T00:30:00Z') // 02:30 Israel, Jan 14
    await job('2026-01-14T21:58:00Z') // 23:58 Israel, Jan 14
    const now = Z('2026-01-14T21:59:00Z') // 23:59 Israel, Jan 14
    for (const tz of SESSION_ZONES) expect(await countIn(tz, now), tz).toBe(2)
  })
})

describe('summer (Israel = UTC+3): the business day starts at 21:00Z the evening before', () => {
  // 2026-07-15 00:00 Israel = 2026-07-14T21:00:00Z
  it('a reply at 23:59 Israel belongs to yesterday; one at 00:00 and one at 02:59 belong to today', async () => {
    await clear()
    await job('2026-07-14T20:59:59Z') // 23:59:59 Israel, Jul 14
    await job('2026-07-14T21:00:00Z') // 00:00:00 Israel, Jul 15
    await job('2026-07-14T23:59:00Z') // 02:59 Israel, Jul 15
    const now = Z('2026-07-15T00:30:00Z') // 03:30 Israel, Jul 15
    for (const tz of SESSION_ZONES) expect(await countIn(tz, now), tz).toBe(2)
    expect(await countSentToday(agencyId, now)).toBe(2)
  })

  it('at 00:05 Israel the count has reset, even though it is still 21:05Z of the previous UTC day', async () => {
    await clear()
    await job('2026-07-14T20:30:00Z') // 23:30 Israel, Jul 14
    const now = Z('2026-07-14T21:05:00Z') // 00:05 Israel, Jul 15
    for (const tz of SESSION_ZONES) expect(await countIn(tz, now), tz).toBe(0)
  })
})

describe('the clock-change day', () => {
  it('2026-03-27 (Israel moves to UTC+3 at 02:00): the day still starts at local midnight, 22:00Z', async () => {
    await clear()
    await job('2026-03-26T21:59:00Z') // 23:59 Israel, Mar 26 (UTC+2)
    await job('2026-03-26T22:00:00Z') // 00:00 Israel, Mar 27 (UTC+2)
    await job('2026-03-27T06:00:00Z') // 09:00 Israel, Mar 27 (UTC+3)
    const now = Z('2026-03-27T07:00:00Z') // 10:00 Israel, Mar 27
    for (const tz of SESSION_ZONES) expect(await countIn(tz, now), tz).toBe(2)
  })
})

describe('what is counted is unchanged', () => {
  it('only this agency’s SENT replies; no-response warnings and closes are not replies to a customer message', async () => {
    await clear()
    await job('2026-01-14T22:05:00Z')
    await job('2026-01-14T22:06:00Z', { status: 'skipped' })
    await job('2026-01-14T22:07:00Z', { status: 'failed' })
    await job('2026-01-14T22:08:00Z', { reason: 'no_response_warning' })
    await job('2026-01-14T22:09:00Z', { reason: 'no_response_close' })
    await job('2026-01-14T22:10:00Z', { agency: 'other' })
    await job('2026-01-14T22:11:00Z', { reason: 'first_contact' })
    expect(await countSentToday(agencyId, Z('2026-01-14T23:00:00Z'))).toBe(2)
  })
})
