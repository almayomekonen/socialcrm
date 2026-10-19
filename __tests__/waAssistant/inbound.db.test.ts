import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

/**
 * The webhook side of the assistant: what gets queued, and what never does.
 * Opt-out and activation keep their precedence; only a number verified for
 * exactly one active recipient in an enabled agency is queued, once per message.
 */
const A = 103
let B: number
let seq = 0
const T0 = Math.floor(Date.now() / 1000)

const text = (from: string, body: string, id = `wamid.__wa_asst_${++seq}`) =>
  processPlatformMessage({ id, from, timestamp: String(T0), type: 'text', text: { body } })
const jobs = () => db('wa_assistant_jobs').orderBy('id')

beforeAll(async () => {
  await agency('__wa_asst_103__', A)
  B = await agency('__wa_asst_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('wa_assistant_jobs').del()
  process.env.WA_ASSISTANT_AGENCY_IDS = String(A)
  delete process.env.OWNER_WA_REMINDERS_AUDIENCE
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
})
afterAll(async () => {
  delete process.env.WA_ASSISTANT_AGENCY_IDS
  await db('wa_assistant_jobs').del()
  await cleanup()
})

describe('queued', () => {
  it('a text from a verified recipient of an enabled agency: one job, linked to that recipient', async () => {
    const u = await user(A)
    const r = await recipient(A, u, '972500005001')
    expect(await text('972500005001', 'סכם לי את היום')).toBe('assistant_queued')
    expect(await jobs()).toMatchObject([{ recipientId: String(r), agencyId: A, userId: u, kind: 'text', question: 'סכם לי את היום', status: 'queued', replyState: null }])
    expect(await db('platform_whatsapp_inbound').first('kind')).toEqual({ kind: 'other' })
  })

  it('a redelivered message is a duplicate: still one job', async () => {
    await recipient(A, await user(A), '972500005002')
    expect(await text('972500005002', 'מי לא קיבל מענה?', 'wamid.__wa_asst_same')).toBe('assistant_queued')
    expect(await text('972500005002', 'מי לא קיבל מענה?', 'wamid.__wa_asst_same')).toBe('duplicate')
    expect(await jobs()).toHaveLength(1)
  })

  it('media: queued as `unsupported` with no text; a reaction is ignored', async () => {
    await recipient(A, await user(A), '972500005003')
    expect(await processPlatformMessage({ id: `wamid.__wa_asst_${++seq}`, from: '972500005003', timestamp: String(T0), type: 'audio', audio: { id: 'x' } })).toBe('assistant_queued')
    expect(await processPlatformMessage({ id: `wamid.__wa_asst_${++seq}`, from: '972500005003', timestamp: String(T0), type: 'reaction', reaction: { emoji: 'x' } })).toBe('ignored')
    expect(await jobs()).toMatchObject([{ kind: 'unsupported', question: null }])
  })

  it('a long message is queued, capped at 1000 characters', async () => {
    await recipient(A, await user(A), '972500005004')
    expect(await text('972500005004', 'א'.repeat(1500))).toBe('assistant_queued')
    expect((await jobs())[0].question).toHaveLength(1000)
  })
})

describe('never queued', () => {
  it('with the flag absent (the default)', async () => {
    delete process.env.WA_ASSISTANT_AGENCY_IDS
    await recipient(A, await user(A), '972500005011')
    expect(await text('972500005011', 'סכם לי את היום')).toBe('ignored')
    expect(await jobs()).toEqual([])
  })

  it('opt-out still wins and is never queued', async () => {
    await recipient(A, await user(A), '972500005012')
    expect(await text('972500005012', 'הסר')).toBe('opted_out')
    expect(await jobs()).toEqual([])
    expect(await db('owner_whatsapp_recipients').first('status')).toEqual({ status: 'opted_out' })
  })

  it('an activation code still goes to activation, never to the assistant', async () => {
    await recipient(A, await user(A), '972500005013')
    expect(await text('972500005013', 'הפעלת תזכורות SocialCRM: ABCD-EFGH')).toBe('activation_rejected')
    expect(await jobs()).toEqual([])
  })

  it('an unknown number', async () => {
    expect(await text('972500005014', 'סכם לי את היום')).toBe('ignored')
    expect(await jobs()).toEqual([])
  })

  it('a number verified for two accounts is ambiguous: refused, nothing queued', async () => {
    process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B}`
    await recipient(A, await user(A), '972500005015')
    await recipient(B, await user(B), '972500005015')
    expect(await text('972500005015', 'סכם לי את היום')).toBe('ignored')
    expect(await jobs()).toEqual([])
  })

  it('a recipient of an agency without the assistant', async () => {
    await recipient(B, await user(B), '972500005016')
    expect(await text('972500005016', 'סכם לי את היום')).toBe('ignored')
    expect(await jobs()).toEqual([])
  })

  it.each([
    ['pending', { status: 'pending', phoneE164: '+972500005017', verifiedAt: null }],
    ['opted out', { status: 'opted_out', optedOutAt: new Date() }],
  ])('a %s recipient', async (_l, patch) => {
    const r = await recipient(A, await user(A), '972500005017')
    await db('owner_whatsapp_recipients').where({ id: r }).update(patch)
    expect(await text('972500005017', 'סכם לי את היום')).toBe('ignored')
    expect(await jobs()).toEqual([])
  })

  it('a suspended user', async () => {
    const u = await user(A)
    await recipient(A, u, '972500005018')
    await db('users').where({ id: u }).update({ suspended: true })
    expect(await text('972500005018', 'סכם לי את היום')).toBe('ignored')
    expect(await jobs()).toEqual([])
  })
})
