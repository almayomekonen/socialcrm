import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The customer's copy of a SmartBee document SmartBee already CONFIRMED, against
 * a real (local test) PostgreSQL. Only the two senders are stood in for: the
 * WhatsApp text send and the email send. Nothing leaves this machine.
 */
import { db } from '@/config/db'
import { deliverSmartbeeDocumentToCustomer, type CustomerDeliveryDeps } from '@/lib/waAssistant/smartbee/customerDelivery'
import { documentCreatedNotice, documentCard } from '@/lib/waAssistant/smartbee/copy'
import { agency, cleanup, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let seq = 0
const LINK = 'https://smartbee.co.il/docs/1_Original.pdf'
const pn = (agencyId: number) => `__sbd_pn_${agencyId}`

type Lead = { lead: number; waId: string; owner: number }
async function lead(agencyId: number, opts: { inboundAgoMs?: number | null; email?: string | null; conversation?: boolean } = {}): Promise<Lead> {
  const owner = await user(agencyId, 'ADMIN', { email: `owner${++seq}@biz.test` })
  const waId = `97253${String(1000000 + ++seq)}`
  const [c] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'לוי', phone: `0${waId.slice(3)}`, email: opts.email ? opts.email.replace('@', `+${++seq}@`) : null, agencyId, userId: owner, createdById: owner, lead: true, status: 'new' })
    .returning('id')
  const id = Number(c.id)
  if (!(await db('whatsapp_connections').where({ agency_id: agencyId }).first('id'))) await db('whatsapp_connections').insert({ user_id: owner, agency_id: agencyId, phone_number_id: pn(agencyId), access_token: 'x' })
  if (opts.conversation !== false) {
    const ago = opts.inboundAgoMs === undefined ? 60_000 : opts.inboundAgoMs
    await db('inbox_conversations').insert({ agencyId, leadId: id, channel: 'whatsapp', businessPhoneNumberId: pn(agencyId), customerWaId: waId, lastInboundAt: ago == null ? null : new Date(Date.now() - ago) })
  }
  return { lead: id, waId, owner }
}

function senders(text: 'sent' | 'refused' | 'ambiguous' = 'sent', email: 'ok' | 'rejected' = 'ok') {
  const sendText = vi.fn(async (_a: Record<string, any>) =>
    text === 'sent' ? { ok: true as const, wamid: `wamid.SBD_${++seq}` } : text === 'refused' ? { ok: false as const, error: 'graph', code: '131026' } : { ok: false as const, error: 'timeout', ambiguous: true as const },
  )
  const sendEmail = vi.fn(async (_a: Record<string, any>) => (email === 'ok' ? { ok: true as const, id: `em_${++seq}` } : { ok: false as const, error: 'rejected' }))
  return { sendText, sendEmail, deps: { sendText: sendText as never, sendEmail: sendEmail as never } satisfies CustomerDeliveryDeps }
}

const deliver = (agencyId: number, l: Lead, deps: CustomerDeliveryDeps, documentId = ++seq) =>
  deliverSmartbeeDocumentToCustomer({ agencyId, documentId, leadId: l.lead, docType: 'Receipt', number: '1045', link: LINK, approvedByUserId: l.owner, nowMs: Date.now(), deps })

beforeAll(async () => {
  A = await agency('__sbd_a__')
  B = await agency('__sbd_b__')
})
beforeEach(() => {
  process.env.AUTOMATIONS_FROM = 'docs@mail.socialcrm.test'
})
afterAll(async () => {
  await db('inbox_messages').whereIn('agencyId', [A, B]).del()
  await db('inbox_conversations').whereIn('agencyId', [A, B]).del()
  await db('whatsapp_connections').whereIn('agency_id', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

describe('WhatsApp first, while the customer\'s 24-hour window is open', () => {
  it('sends the PDF link to the LEAD\'s WhatsApp, from the business number, and records it in the inbox', async () => {
    const l = await lead(A, { email: 'dana@example.com' })
    const s = senders()
    expect(await deliver(A, l, s.deps)).toBe('whatsapp')
    expect(s.sendText).toHaveBeenCalledTimes(1)
    const call = s.sendText.mock.calls[0][0]
    expect(call).toMatchObject({ to: l.waId, phoneNumberId: pn(A), consent: { kind: 'automated', agencyId: A } })
    for (const part of ['דנה לוי', 'קבלה מספר 1045', LINK]) expect(call.body).toContain(part)
    expect(s.sendEmail).not.toHaveBeenCalled()
    const stored = await db('inbox_messages').where({ agencyId: A, leadId: l.lead }).first('text')
    expect(stored?.text).toContain(LINK)
  })

  it('an ambiguous WhatsApp send is NOT followed by an email (the customer may already have it)', async () => {
    const l = await lead(A, { email: 'dana@example.com' })
    const s = senders('ambiguous')
    expect(await deliver(A, l, s.deps)).toBe('whatsapp_unknown')
    expect(s.sendEmail).not.toHaveBeenCalled()
  })
})

describe('email when WhatsApp cannot reach the customer', () => {
  it('window closed → the PDF link by email to the lead\'s address, once per document', async () => {
    const l = await lead(A, { inboundAgoMs: 30 * 3600_000, email: 'Dana@Example.com' })
    const s = senders()
    expect(await deliver(A, l, s.deps, 777)).toBe('email')
    expect(s.sendText).not.toHaveBeenCalled()
    const mail = s.sendEmail.mock.calls[0][0]
    expect(mail.to).toMatch(/^dana\+\d+@example\.com$/)
    expect(mail.subject).toContain('קבלה מספר 1045')
    expect(mail.html).toContain(LINK)
    expect(mail.idempotencyKey).toBe(`smartbee-document/${A}/777`)
  })

  it('no WhatsApp conversation at all → email', async () => {
    const l = await lead(A, { conversation: false, email: 'dana@example.com' })
    const s = senders()
    expect(await deliver(A, l, s.deps)).toBe('email')
  })

  it('a definite WhatsApp refusal (nothing delivered) → email', async () => {
    const l = await lead(A, { email: 'dana@example.com' })
    const s = senders('refused')
    expect(await deliver(A, l, s.deps)).toBe('email')
    expect(s.sendText).toHaveBeenCalledTimes(1)
    expect(s.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('delivery failure is reported, never retried as a new document', () => {
  it('window closed and no email → no_channel, nothing sent', async () => {
    const l = await lead(A, { inboundAgoMs: null, email: null })
    const s = senders()
    expect(await deliver(A, l, s.deps)).toBe('no_channel')
    expect(s.sendText).not.toHaveBeenCalled()
    expect(s.sendEmail).not.toHaveBeenCalled()
  })

  it('email rejected → failed', async () => {
    const l = await lead(A, { inboundAgoMs: null, email: 'dana@example.com' })
    expect(await deliver(A, l, senders('sent', 'rejected').deps)).toBe('failed')
  })

  it('another agency\'s lead is never reached', async () => {
    const other = await lead(B, { email: 'other@example.com' })
    const s = senders()
    expect(await deliver(A, other, s.deps)).toBe('no_channel')
    expect(s.sendText).not.toHaveBeenCalled()
    expect(s.sendEmail).not.toHaveBeenCalled()
  })

  it('the owner is told the outcome; a failure says the document exists and not to issue again', () => {
    const notice = (customer: Parameters<typeof documentCreatedNotice>[0]['customer']) =>
      documentCreatedNotice({ docType: 'Receipt', number: '1045', amount: 50, allocationNumber: null, link: LINK, customer })
    expect(notice('whatsapp')).toContain('נשלח ללקוח בוואטסאפ')
    expect(notice('email')).toContain('נשלח ללקוח במייל')
    for (const bad of ['no_channel', 'failed', 'whatsapp_unknown'] as const) {
      expect(notice(bad)).toContain('אין צורך להפיק שוב')
      expect(notice(bad)).toContain(LINK)
    }
    expect(notice('no_channel')).toContain('לא נשלח ללקוח')
  })

  it('the approval card says the customer will get the link', () => {
    const card = documentCard({ docType: 'Receipt', lead: 'דנה לוי', customerIdNumber: null, description: 'x', amount: 50, vatOption: null, payment: null, sandbox: false })
    expect(card).toContain('יישלח ללקוח בוואטסאפ')
    expect(card).not.toContain('הוא לא יישלח ללקוח')
  })
})
