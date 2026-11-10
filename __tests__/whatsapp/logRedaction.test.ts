import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Customer numbers, tokens and message links must never reach the logs, and hiding
 * them must not change what Meta receives. The opt-out gate needs a database and is
 * covered elsewhere, so here it simply runs the send. `fetch` is stubbed: nothing is sent.
 */

vi.mock('@/lib/whatsapp/optOut/sendGate', () => ({
  runGatedWhatsappSend: (_consent: unknown, _to: string, send: () => Promise<unknown>) => send(),
}))

const { maskPhone, redactLogText, waTrace } = await import('@/lib/inbox/autoresponse/waTrace')
const { sendWhatsappInteractive, sendWhatsappText } = await import('@/lib/whatsapp/sendMessage')
const { sendWhatsappTemplate } = await import('@/lib/whatsapp/sendTemplateMessage')

const CUSTOMER = '972545550021'
const LOCAL = '0545550021'
const LINK = 'https://bit.test.invalid/group/private-token'
const TOKEN = 'EAAsecretaccesstoken1234567890'
const base = {
  phoneNumberId: '123456789012345',
  accessToken: TOKEN,
  to: LOCAL,
  consent: { kind: 'automated', agencyId: 1 } as never,
}

let requests: Array<Record<string, unknown>>
let headers: Array<Record<string, string>>
let reply: { status: number; body: unknown }
let spies: Array<{ mock: { calls: unknown[][] } }>

const logged = () => JSON.stringify(spies.map((s) => s.mock.calls))
const accepted = { status: 200, body: { contacts: [{ input: CUSTOMER, wa_id: CUSTOMER }], messages: [{ id: 'wamid.OK' }] } }
const leakyError = {
  status: 400,
  body: {
    error: {
      message: `Bad recipient +${CUSTOMER}, link ${LINK}, Bearer ${TOKEN}`,
      code: 131000,
      fbtrace_id: 'AbC123xyz',
      error_data: { details: `number ${CUSTOMER} at ${LINK}` },
    },
  },
}
const missingId = { status: 200, body: { contacts: [{ input: CUSTOMER, wa_id: CUSTOMER }] } }

beforeEach(() => {
  requests = []
  headers = []
  reply = accepted
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)))
      headers.push(init.headers as Record<string, string>)
      return new Response(JSON.stringify(reply.body), { status: reply.status })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('maskPhone', () => {
  it.each([
    [CUSTOMER, '***0021'],
    [`+${CUSTOMER}`, '***0021'],
    ['054-555-0021', '***0021'],
    ['123', '***'],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%s → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected)
  })
})

describe('redactLogText', () => {
  it('removes numbers, links and tokens from provider text', () => {
    const out = String(redactLogText(`to +${CUSTOMER} / 054-555-0021 at ${LINK} with Bearer ${TOKEN} and ${TOKEN}`))
    expect(out).not.toContain('545550021')
    expect(out).not.toContain('555-0021')
    expect(out).not.toContain('test.invalid')
    expect(out).not.toContain(TOKEN)
  })
  it('leaves ordinary text, short codes and identifiers alone', () => {
    expect(redactLogText('(#131047) Re-engagement message')).toBe('(#131047) Re-engagement message')
    expect(redactLogText('trace AbC12345678901xyz')).toBe('trace AbC12345678901xyz')
    expect(redactLogText(undefined)).toBeUndefined()
  })
})

describe('waTrace', () => {
  it('masks customer numbers and keeps the business id and message id for debugging', () => {
    waTrace('STAGE', {}, { recipient: CUSTOMER, phoneNumber: CUSTOMER, phone_number_id: '123456789012345', wamid: 'wamid.X' })
    const line = logged()
    expect(line).not.toContain(CUSTOMER)
    expect(line).toContain('***0021')
    expect(line).toContain('123456789012345')
    expect(line).toContain('wamid.X')
  })
  it('cleans nested provider errors', () => {
    waTrace('STAGE', {}, { error: { details: { to: `+${CUSTOMER}`, at: LINK } }, error_data: [`${CUSTOMER}`], message: LINK })
    expect(logged()).not.toContain(CUSTOMER)
    expect(logged()).not.toContain('test.invalid')
  })
  it('never throws into the send flow', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => waTrace('STAGE', {}, { error: circular })).not.toThrow()
  })
})

describe('delivery is unaffected, logs are clean', () => {
  const senders: Array<[string, () => Promise<unknown>, Record<string, unknown>]> = [
    [
      'text',
      () => sendWhatsappText({ ...base, body: `hello ${LINK}` }),
      { type: 'text', text: { preview_url: false, body: `hello ${LINK}` } },
    ],
    [
      'interactive CTA',
      () =>
        sendWhatsappInteractive({
          ...base,
          body: 'body',
          interactive: {
            type: 'cta_url',
            body: { text: 'body' },
            action: { name: 'cta_url', parameters: { display_text: 'open', url: LINK } },
          },
        }),
      {
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'body' },
          action: { name: 'cta_url', parameters: { display_text: 'open', url: LINK } },
        },
      },
    ],
    [
      'template',
      () => sendWhatsappTemplate({ ...base, name: 'tpl', language: 'he', params: [] }),
      { type: 'template', template: { name: 'tpl', language: { code: 'he' } } },
    ],
  ]

  it.each(senders)('%s: Meta gets the full number, link and token; the logs get none of them', async (_name, send, content) => {
    expect(await send()).toEqual({ ok: true, wamid: 'wamid.OK' })
    expect(requests).toEqual([{ messaging_product: 'whatsapp', recipient_type: 'individual', to: CUSTOMER, ...content }])
    expect(headers[0].Authorization).toBe(`Bearer ${TOKEN}`)
    expect(logged()).toContain('***0021')
    expect(logged()).not.toContain(CUSTOMER)
    expect(logged()).not.toContain(TOKEN)
    expect(logged()).not.toContain('test.invalid')
  })

  it.each(senders)('%s: a Graph error quoting private data is returned to the caller but not logged', async (_name, send) => {
    reply = leakyError
    const result = (await send()) as { ok: boolean; code: string; error: string }
    expect(result).toMatchObject({ ok: false, code: '131000' })
    expect(result.error).toBe(leakyError.body.error.message)
    expect(logged()).not.toContain(CUSTOMER)
    expect(logged()).not.toContain(TOKEN)
    expect(logged()).not.toContain('test.invalid')
    expect(logged()).toContain('AbC123xyz')
  })

  it.each(senders)('%s: a response with no message id stays ambiguous and its contacts are not logged', async (_name, send) => {
    reply = missingId
    expect(await send()).toMatchObject({ ok: false, ambiguous: true })
    expect(logged()).not.toContain(CUSTOMER)
  })
})
