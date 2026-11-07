/**
 * The inbound path records where `messageTimestamp` came from, on both
 * platform_whatsapp_inbound and wa_assistant_jobs. Only 'meta' is verified.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { agency, cleanup, recipient, resetBetweenTests, user } from '../../ownerWhatsappReminders/reminderFixtures'

let A = 0
let seq = 0
const nowSec = () => Math.floor(Date.now() / 1000)
const send = (from: string, timestamp: unknown) => {
  const id = `wamid.__ts_src_${++seq}`
  return processPlatformMessage({ id, from, ...(timestamp === undefined ? {} : { timestamp }), type: 'text', text: { body: 'מה יש לי היום?' } }).then(() => id)
}
const inbound = (wamid: string) => db('platform_whatsapp_inbound').where({ wamid }).first('messageTimestamp', 'timestampSource')
const job = (wamid: string) => db('wa_assistant_jobs').where({ wamid }).first('messageTimestamp', 'timestampSource')

beforeAll(async () => {
  A = await agency('__ts_src__')
})
beforeEach(async () => {
  await resetBetweenTests()
  process.env.WA_ASSISTANT_AGENCY_IDS = String(A)
  delete process.env.OWNER_WA_REMINDERS_AUDIENCE
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
})
afterAll(async () => {
  delete process.env.WA_ASSISTANT_AGENCY_IDS
  await db('wa_assistant_jobs').where('wamid', 'like', 'wamid.__ts_src_%').del()
  await cleanup()
})

describe('timestamp provenance on the inbound path', () => {
  it("Meta's current timestamp → 'meta' on both rows, value unchanged", async () => {
    const u = await user(A)
    await recipient(A, u, '972500009001', undefined, 'v4')
    const ts = nowSec() - 30
    const wamid = await send('972500009001', String(ts))
    expect(await inbound(wamid)).toEqual({ messageTimestamp: String(ts), timestampSource: 'meta' })
    expect(await job(wamid)).toEqual({ messageTimestamp: String(ts), timestampSource: 'meta' })
  })

  it("no timestamp from Meta → the server-time fallback, marked 'server'", async () => {
    const u = await user(A)
    await recipient(A, u, '972500009002', undefined, 'v4')
    const before = nowSec()
    const wamid = await send('972500009002', undefined)
    const row = await inbound(wamid)
    expect(row?.timestampSource).toBe('server')
    expect(Number(row?.messageTimestamp)).toBeGreaterThanOrEqual(before)
    expect((await job(wamid))?.timestampSource).toBe('server')
  })

  it('a Meta timestamp outside the plausible range is stored as before but unverified (NULL)', async () => {
    const u = await user(A)
    await recipient(A, u, '972500009003', undefined, 'v4')
    const old = nowSec() - 30 * 86_400
    const wamid = await send('972500009003', String(old))
    expect(await inbound(wamid)).toEqual({ messageTimestamp: String(old), timestampSource: null })
  })

  it('a sender who is not an owner still gets the inbound row with its provenance', async () => {
    const wamid = await send('972500009099', String(nowSec()))
    expect((await inbound(wamid))?.timestampSource).toBe('meta')
  })
})
