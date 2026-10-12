import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { MIN, ago, agency, cleanup, clearEnv, conversation, deliveries, escalate, message, mockGraph, recipient, resetBetweenTests, sentTo, setLiveEnv, user } from './reminderFixtures'

/**
 * Who gets reminded about what, through the REAL tick on a real database (Graph
 * is mocked: nothing leaves the machine).
 */
let A: number
let B: number
let EXCLUDED: number

beforeAll(async () => {
  A = await agency('__owr_elig_a__')
  B = await agency('__owr_elig_b__')
  EXCLUDED = await agency('__owr_elig_158__', 158)
})
beforeEach(async () => {
  await resetBetweenTests()
  setLiveEnv([A, B])
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await cleanup()
})

describe('off by default', () => {
  it('without the platform number or an allowlist: no query result, no row, no send', async () => {
    clearEnv()
    const g = mockGraph()
    const c = await conversation(A, { lead: false })
    await escalate(c, ago(121 * MIN))
    await recipient(A, await user(A), '972500000101')
    expect((await tickOwnerWhatsappReminders()).mode).toBe('disabled')
    expect(g.calls).toEqual([])
    expect(await db('owner_whatsapp_reminders')).toEqual([])
  })

  it('kill switch off (dry run): counts what it would do, writes and sends nothing', async () => {
    delete process.env.OWNER_WA_REMINDERS_SEND_ENABLED
    const g = mockGraph()
    const c = await conversation(A, { lead: false })
    await escalate(c, ago(121 * MIN))
    await recipient(A, await user(A), '972500000102')
    expect(await tickOwnerWhatsappReminders()).toMatchObject({ mode: 'dry_run', candidates: 1, wouldRemind: 1, scheduled: 0 })
    expect(g.calls).toEqual([])
    expect(await db('owner_whatsapp_reminders')).toEqual([])
  })
})

describe('timing and dedup', () => {
  it('one reminder at 120 minutes, to the handler only, with the exact payload; later ticks add nothing', async () => {
    const g = mockGraph()
    const handler = await user(A, 'AGNT')
    await recipient(A, handler, '972500000111')
    await recipient(A, await user(A), '972500000112')
    const c = await conversation(A, { handlerId: handler })
    await escalate(c, ago(121 * MIN))
    await tickOwnerWhatsappReminders()
    expect(sentTo(g.calls)).toEqual(['972500000111'])
    expect(g.calls[0].body.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'שעתיים' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(c.id) }] },
    ])
    expect(await deliveries()).toMatchObject([{ status: 'sent', wamid: 'wamid.SENT_1', conversationId: String(c.id) }])
    await tickOwnerWhatsappReminders()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(1)
  })

  it('119 minutes: not yet; older than 24 hours: never', async () => {
    const g = mockGraph()
    await recipient(A, await user(A), '972500000121')
    const early = await conversation(A, { lead: false })
    await escalate(early, ago(119 * MIN))
    const stale = await conversation(A, { lead: false })
    await escalate(stale, ago(24 * 60 * MIN + MIN))
    expect((await tickOwnerWhatsappReminders()).candidates).toBe(0)
    expect(g.calls).toEqual([])
  })
})

describe('recipients', () => {
  it('no active handler, or no lead at all: up to 3 ADMINs, never GM, never suspended', async () => {
    const g = mockGraph()
    for (const [i, d] of [[1, 5], [2, 4], [3, 3], [4, 2]] as const) await recipient(A, await user(A), `97250000013${i}`, ago(d * 24 * 60 * MIN))
    await recipient(A, await user(A, 'GM'), '972500000139', ago(9 * 24 * 60 * MIN))
    await recipient(A, await user(A, 'ADMIN', { suspended: true }), '972500000138', ago(9 * 24 * 60 * MIN))
    const leadless = await conversation(A, { lead: false })
    await escalate(leadless, ago(121 * MIN))
    await tickOwnerWhatsappReminders()
    expect(sentTo(g.calls)).toEqual(['972500000131', '972500000132', '972500000133'])
  })

  it('a handler who is not activated falls back to ADMINs', async () => {
    const g = mockGraph()
    await recipient(A, await user(A), '972500000141')
    const c = await conversation(A, { handlerId: await user(A, 'AGNT') })
    await escalate(c, ago(121 * MIN))
    await tickOwnerWhatsappReminders()
    expect(sentTo(g.calls)).toEqual(['972500000141'])
  })

  it('never someone verified after the hand-off, never an owner about their own number', async () => {
    const g = mockGraph()
    await recipient(A, await user(A), '972500000151', ago(60 * MIN))
    const self = await conversation(A, { lead: false, customerWaId: '972500000152' })
    await recipient(A, await user(A), '972500000152')
    await escalate(self, ago(121 * MIN))
    expect(await tickOwnerWhatsappReminders()).toMatchObject({ candidates: 1, noRecipients: 1 })
    expect(g.calls).toEqual([])
  })
})

describe('which hand-offs', () => {
  it('questionnaire hand-offs are included', async () => {
    const g = mockGraph()
    await recipient(A, await user(A), '972500000161')
    const c = await conversation(A, { lead: false })
    const at = ago(121 * MIN)
    await escalate(c, at)
    await db('questionnaire_sessions').insert({ conversationId: c.id, agencyId: A, definition: {}, status: 'completed', endedReason: 'completed', endedAt: at })
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(1)
  })

  it('a human reply (SocialCRM or the Business app) cancels; AI and automation messages do not', async () => {
    const g = mockGraph()
    const admin = await user(A)
    await recipient(A, admin, '972500000171')
    const composer = await conversation(A, { lead: false })
    const echo = await conversation(A, { lead: false })
    const ai = await conversation(A, { lead: false })
    for (const c of [composer, echo, ai]) await escalate(c, ago(130 * MIN))
    await message(composer, { dir: 'outbound', at: ago(125 * MIN), userId: admin })
    await message(echo, { dir: 'outbound', at: ago(125 * MIN), source: 'smb_message_echo' })
    await message(ai, { dir: 'outbound', at: ago(125 * MIN), source: 'auto_response', userId: admin })
    await tickOwnerWhatsappReminders()
    expect(g.calls.map((c) => c.body.template.components[1].parameters[0].text)).toEqual([String(ai.id)])
  })

  it('closed or lost leads, and archived, closed or personal conversations: never', async () => {
    const g = mockGraph()
    await recipient(A, await user(A), '972500000181')
    for (const opts of [{ leadStatus: 'closed' }, { leadStatus: 'lost' }, { state: 'archived' }, { state: 'closed' }, { isPersonal: true }]) {
      await escalate(await conversation(A, opts), ago(121 * MIN))
    }
    expect((await tickOwnerWhatsappReminders()).candidates).toBe(0)
    expect(g.calls).toEqual([])
  })
})

describe('tenant isolation', () => {
  it('another agency\'s recipients are never used', async () => {
    const g = mockGraph()
    await recipient(B, await user(B), '972500000191')
    const c = await conversation(A, { lead: false })
    await escalate(c, ago(121 * MIN))
    expect(await tickOwnerWhatsappReminders()).toMatchObject({ candidates: 1, noRecipients: 1 })
    expect(g.calls).toEqual([])
  })

  it('agency 158 (not allowlisted) never gets a reminder, a delivery or a send', async () => {
    const g = mockGraph()
    await recipient(EXCLUDED, await user(EXCLUDED), '972500000199')
    const c = await conversation(EXCLUDED, { lead: false })
    await escalate(c, ago(121 * MIN))
    expect((await tickOwnerWhatsappReminders()).candidates).toBe(0)
    expect(g.calls).toEqual([])
    expect(await db('owner_whatsapp_reminders').where({ agencyId: EXCLUDED })).toEqual([])
  })
})
