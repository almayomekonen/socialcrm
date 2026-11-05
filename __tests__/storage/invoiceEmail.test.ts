import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageNotFoundError, StorageUnavailableError } from '@/lib/storage/objects'

/** The invoice email carries the private PDF itself, and no link to storage. */

const h = vi.hoisted(() => ({ send: vi.fn(), bytes: vi.fn(), logged: [] as string[] }))

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['where', 'whereIn', 'orderBy']) c[m] = () => c
  c.first = async () => result
  return c
}

const INVOICE = {
  id: 9, docState: 'issued', kind: 'invoice', leadId: 3, documentNumber: 42, documentYear: 2026, totalAmount: 118, currency: 'ILS',
  issuedAt: '2026-11-05T10:00:00.000Z', legalNameSnapshot: 'דני כהן', emailSnapshot: '', issuerNameSnapshot: 'העסק',
  issuerBusinessTypeSnapshot: 'authorized', issuerTaxIdSnapshot: '1', issuerAddressSnapshot: '', issuerPhoneSnapshot: '', issuerEmailSnapshot: '',
}

vi.mock('@/config/db', () => ({
  db: (table: string) => {
    if (table === 'clients') return chain({ id: 3 })
    if (table === 'bill_invoices') return chain(INVOICE)
    if (table === 'bill_documents') return chain({ url: '/api/billing/invoice/9/download', path: 'tenants/7/invoices/9/x.pdf' })
    return chain(undefined)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/requireUser', () => ({ requireProductAccess: async () => ({ id: 1, agencyId: 7, role: 'ADMIN' }) }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [] }) }))
vi.mock('@/db/agencies', () => ({ getAgencyById: async () => ({ name: 'העסק' }) }))
vi.mock('@/db/billing/issuer', () => ({ getIssuerForRender: async () => null }))
vi.mock('@/db/billing/events', () => ({ appendFinancialEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/email/sender', () => ({ sendEmail: h.send }))
vi.mock('@/lib/storage/objects', async (original) => ({
  ...(await original<typeof import('@/lib/storage/objects')>()),
  getObjectBytes: h.bytes,
}))

import { sendInvoiceEmailAction } from '@/actions/billing/send'

const CUSTOMER = 'customer-private@example.com'
const send = () => sendInvoiceEmailAction({ invoiceId: 9, leadId: 3, recipientEmail: CUSTOMER })

beforeEach(() => {
  vi.clearAllMocks()
  h.logged.length = 0
  h.bytes.mockResolvedValue(new TextEncoder().encode('%PDF-1.7'))
  h.send.mockResolvedValue({ ok: true, id: 'm1' })
  const capture = (...a: unknown[]) => void h.logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})

describe('sendInvoiceEmailAction', () => {
  it('attaches the PDF, and the email holds no storage link', async () => {
    await expect(send()).resolves.toEqual({ success: true })
    const mail = h.send.mock.calls[0][0]
    expect(mail.to).toBe(CUSTOMER)
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0].filename).toBe('Invoice-00042-דני_כהן.pdf')
    expect(mail.attachments[0].content.toString()).toBe('%PDF-1.7')
    expect(mail.html).not.toMatch(/amazonaws|r2\.cloudflarestorage|X-Amz-|\/api\/billing/)
  })

  it('a missing PDF refuses before anything reaches the customer', async () => {
    h.bytes.mockRejectedValue(new StorageNotFoundError())
    await expect(send()).resolves.toEqual({ error: true, reason: 'pdf_not_ready' })
    expect(h.send).not.toHaveBeenCalled()
  })

  it('an R2 outage is a failed send, not a silent one', async () => {
    h.bytes.mockRejectedValue(new StorageUnavailableError('InternalError', 500))
    await expect(send()).resolves.toEqual({ error: true, reason: 'transport_failed' })
    expect(h.send).not.toHaveBeenCalled()
  })

  it('this action logs neither the recipient nor the subject', async () => {
    await send()
    h.send.mockResolvedValueOnce({ ok: false, error: 'x' })
    await sendInvoiceEmailAction({ invoiceId: 9, leadId: 3, recipientEmail: CUSTOMER })
    expect(h.logged.join('\n')).not.toContain(CUSTOMER)
    expect(h.logged.join('\n')).not.toContain('דני')
  })
})
