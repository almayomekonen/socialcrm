import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Vercel logs drain to Axiom: what `sendEmail` logs is kept there. */

const h = vi.hoisted(() => ({ send: vi.fn(), logged: [] as string[] }))
vi.mock('@/config/resend', () => ({ default: { emails: { send: h.send } } }))

import { sendEmail } from '@/lib/email/sender'

const INPUT = { to: 'customer-private@example.com', subject: 'חשבונית לדני כהן', html: '<p>גוף ההודעה הסודי</p>', replyTo: 'reply-private@example.com' }

beforeEach(() => {
  vi.clearAllMocks()
  h.logged.length = 0
  process.env.RESEND = 're_supersecretapikey'
  const capture = (...a: unknown[]) => void h.logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture)
})

function expectNothingSensitive() {
  const all = h.logged.join('\n')
  for (const secret of ['customer-private', 'reply-private', 'example.com', 'דני כהן', 'גוף ההודעה', 're_super', 'apiKey']) {
    expect(all).not.toContain(secret)
  }
}

describe('sendEmail logging', () => {
  it('a successful send logs the message id, and not who or what', async () => {
    h.send.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
    await expect(sendEmail(INPUT)).resolves.toEqual({ ok: true, id: 'msg_1' })
    expect(h.logged.join('\n')).toContain('msg_1')
    expectNothingSensitive()
  })

  it('still passes the recipient, subject and attachments to the provider', async () => {
    h.send.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
    const attachments = [{ filename: 'a.pdf', content: Buffer.from('%PDF') }]
    await sendEmail({ ...INPUT, attachments })
    expect(h.send.mock.calls[0][0]).toMatchObject({ to: INPUT.to, subject: INPUT.subject, attachments })
  })

  it('a provider error quoting the address is neither logged nor returned with it', async () => {
    h.send.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field: customer-private@example.com' } })
    const result = await sendEmail(INPUT)
    expect(result).toEqual({ ok: false, error: 'Invalid `to` field: [email]' })
    expect(h.logged.join('\n')).toContain('validation_error')
    expectNothingSensitive()
  })

  it('a transient retry stays clean', async () => {
    h.send
      .mockResolvedValueOnce({ data: null, error: { name: 'rate_limit', statusCode: 429, message: 'limit for customer-private@example.com' } })
      .mockResolvedValueOnce({ data: { id: 'msg_2' }, error: null })
    await expect(sendEmail(INPUT)).resolves.toEqual({ ok: true, id: 'msg_2' })
    expectNothingSensitive()
  })

  it('a response with no id stays clean', async () => {
    h.send.mockResolvedValue({ data: {}, error: null })
    await expect(sendEmail(INPUT)).resolves.toEqual({ ok: false, error: 'no_message_id' })
    expectNothingSensitive()
  })
})
