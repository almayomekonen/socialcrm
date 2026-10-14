import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitingTimeHebrew } from '@/lib/ownerWhatsappReminders/waitingTime'
import { selectReminderRecipients, type ActiveRecipient } from '@/lib/ownerWhatsappReminders/selectRecipients'
import { REMINDER_TEMPLATE } from '@/lib/ownerWhatsappReminders/constants'
import { buildReminderPayload, classifyRejection, sendOwnerReminder } from '@/lib/whatsapp/platform/sendReminder'
import { isOwnerWhatsappReminderSendEnabled, platformWhatsappAccessToken } from '@/lib/flags/ownerWhatsappReminderFlags'

const H = 3_600_000
const t0 = new Date('2026-10-13T08:00:00Z')

describe('waiting time in Hebrew', () => {
  it.each([
    [2 * H, 'שעתיים'],
    [2 * H + 59 * 60_000, 'שעתיים'],
    [3 * H, '3 שעות'],
    [23 * H, '23 שעות'],
    [H, 'שעה'],
  ])('%i ms -> %s', (ms, words) => expect(waitingTimeHebrew(t0, new Date(t0.getTime() + ms))).toBe(words))
})

describe('recipient selection', () => {
  const r = (over: Partial<ActiveRecipient> & { recipientId: number; userId: number }): ActiveRecipient => ({
    role: 'ADMIN', phoneE164: `+9725000000${String(over.recipientId).padStart(2, '0')}`, verifiedAt: new Date('2026-10-01T00:00:00Z'), ...over,
  })
  const escalatedAt = new Date('2026-10-12T10:00:00Z')

  it('the lead handler alone, when they are an active recipient', () => {
    const list = [r({ recipientId: 1, userId: 11 }), r({ recipientId: 2, userId: 22, role: 'AGNT' })]
    expect(selectReminderRecipients({ handlerUserId: 22, escalatedAt, customerWaId: '972599999999', recipients: list }).map((x) => x.userId)).toEqual([22])
  })

  it('otherwise up to 3 ADMINs (never GM or AGNT), earliest verified first', () => {
    const list = [
      r({ recipientId: 1, userId: 11, verifiedAt: new Date('2026-10-04T00:00:00Z') }),
      r({ recipientId: 2, userId: 12, role: 'GM' }),
      r({ recipientId: 3, userId: 13, verifiedAt: new Date('2026-10-02T00:00:00Z') }),
      r({ recipientId: 4, userId: 14, verifiedAt: new Date('2026-10-03T00:00:00Z') }),
      r({ recipientId: 5, userId: 15, verifiedAt: new Date('2026-10-01T00:00:00Z') }),
      r({ recipientId: 6, userId: 16, role: 'AGNT' }),
    ]
    expect(selectReminderRecipients({ handlerUserId: 99, escalatedAt, customerWaId: null, recipients: list }).map((x) => x.userId)).toEqual([15, 13, 14])
    expect(selectReminderRecipients({ handlerUserId: null, escalatedAt, customerWaId: null, recipients: list }).map((x) => x.userId)).toEqual([15, 13, 14])
  })

  it('never someone who activated after the hand-off (no backlog)', () => {
    const late = r({ recipientId: 1, userId: 11, verifiedAt: new Date('2026-10-12T11:00:00Z') })
    expect(selectReminderRecipients({ handlerUserId: 11, escalatedAt, customerWaId: null, recipients: [late] })).toEqual([])
  })

  it('never an owner about a conversation with their own number; the handler then falls back to admins', () => {
    const self = r({ recipientId: 1, userId: 11, phoneE164: '+972500000071' })
    const admin = r({ recipientId: 2, userId: 12 })
    expect(selectReminderRecipients({ handlerUserId: 11, escalatedAt, customerWaId: '972500000071', recipients: [self, admin] }).map((x) => x.userId)).toEqual([12])
  })

  it('nobody active means nobody', () => {
    expect(selectReminderRecipients({ handlerUserId: 1, escalatedAt, customerWaId: null, recipients: [] })).toEqual([])
  })
})

describe('template and payload: no lead or customer data', () => {
  it('the template carries one body variable (waiting time) and a URL button variable (conversation id)', () => {
    expect(REMINDER_TEMPLATE).toMatchObject({ name: 'lead_followup_alert', language: 'he', category: 'UTILITY' })
    expect(REMINDER_TEMPLATE.body.match(/\{\{\d\}\}/g)).toEqual(['{{1}}'])
    expect(REMINDER_TEMPLATE.button.url).toBe('https://getsocialcrm.com/inbox?conversation={{1}}')
  })

  it('the exact Graph payload', () => {
    expect(buildReminderPayload({ toDigits: '972500000071', waitingText: 'שעתיים', conversationId: 4242 })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '972500000071',
      type: 'template',
      template: {
        name: 'lead_followup_alert',
        language: { code: 'he' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'שעתיים' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '4242' }] },
        ],
      },
    })
  })
})

describe('Meta error classes', () => {
  it.each([
    ['130429', 'rate_limit'], ['131056', 'rate_limit'], ['4', 'rate_limit'],
    ['190', 'account'], ['200', 'account'], ['10', 'account'], ['131042', 'account'], ['131031', 'account'], ['132001', 'account'], ['132015', 'account'], ['368', 'account'],
    ['131026', 'recipient'], ['131050', 'recipient'],
    ['999999', 'other'], [null, 'other'],
  ])('%s -> %s', (code, scope) => expect(classifyRejection(code)).toBe(scope))
})

describe('kill switch and token: absence blocks', () => {
  afterEach(() => {
    delete process.env.OWNER_WA_REMINDERS_SEND_ENABLED
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
  })
  it('only the exact value 1 sends', () => {
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) {
      if (v === undefined) delete process.env.OWNER_WA_REMINDERS_SEND_ENABLED
      else process.env.OWNER_WA_REMINDERS_SEND_ENABLED = v
      expect(isOwnerWhatsappReminderSendEnabled()).toBe(false)
    }
    process.env.OWNER_WA_REMINDERS_SEND_ENABLED = '1'
    expect(isOwnerWhatsappReminderSendEnabled()).toBe(true)
  })
  it('no token, or a stub, is no token', () => {
    expect(platformWhatsappAccessToken()).toBeNull()
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = 'x'
    expect(platformWhatsappAccessToken()).toBeNull()
  })
})

describe('sender outcomes', () => {
  const TOKEN = 'EAAG_test_token_not_real_0123456789'
  const send = (timeoutMs?: number) =>
    sendOwnerReminder({ phoneNumberId: '1000000000001', accessToken: TOKEN, toE164: '+972500000071', waitingText: 'שעתיים', conversationId: 7, deliveryId: 1, timeoutMs })
  const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
  afterEach(() => vi.restoreAllMocks())

  it('2xx with a message id: sent, by POST to the platform number only', async () => {
    const spy = reply(200, { messages: [{ id: 'wamid.OK' }] })
    expect(await send()).toEqual({ kind: 'sent', wamid: 'wamid.OK' })
    expect(String(spy.mock.calls[0][0])).toMatch(/\/1000000000001\/messages$/)
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })

  it('unknown: 2xx without an id, 5xx, a timeout, or a network failure', async () => {
    reply(200, {})
    expect(await send()).toMatchObject({ kind: 'unknown', reason: 'no_message_id' })
    reply(503, { error: { code: 2 } })
    expect(await send()).toMatchObject({ kind: 'unknown', reason: 'server_error' })
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_u, init) => new Promise((_res, rej) => (init as RequestInit).signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
    expect(await send(20)).toMatchObject({ kind: 'unknown', reason: 'timeout' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await send()).toMatchObject({ kind: 'unknown', reason: 'network' })
  })

  it('4xx: rejected with its class', async () => {
    reply(400, { error: { code: 130429 } })
    expect(await send()).toEqual({ kind: 'rejected', scope: 'rate_limit', code: '130429', httpStatus: 400 })
    reply(401, { error: { code: 190 } })
    expect(await send()).toMatchObject({ kind: 'rejected', scope: 'account' })
  })

  it('logs neither the number nor the token', async () => {
    const log = vi.spyOn(console, 'log')
    reply(200, { messages: [{ id: 'wamid.OK' }] })
    await send()
    const text = JSON.stringify(log.mock.calls)
    expect(text).not.toContain('972500000071')
    expect(text).not.toContain(TOKEN)
  })
})
