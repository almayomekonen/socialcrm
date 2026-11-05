import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { PdfRenderError } from '@/lib/pdf/renderer'
import { StorageConfigError } from '@/lib/storage/config'
import { StorageNotFoundError, StorageUnavailableError } from '@/lib/storage/objects'

/** Pending → terminal, on every path. The boundaries are faked; the decisions are real. */

const h = vi.hoisted(() => ({
  invoice: null as null | Record<string, unknown>,
  doc: null as null | Record<string, unknown>,
  render: vi.fn(),
  put: vi.fn(),
  head: vi.fn(),
  ready: vi.fn(async (_: unknown) => undefined),
  failed: vi.fn(async (..._: unknown[]) => undefined),
  pending: vi.fn(),
  hasReady: vi.fn(),
  create: vi.fn(async (_: unknown) => 55),
  closeStale: vi.fn(async (..._: unknown[]) => undefined),
}))

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['where', 'orderBy']) c[m] = () => c
  c.first = async () => result()
  c.then = (ok: (v: unknown[]) => unknown) => Promise.resolve(ok([{ lineNumber: 1 }]))
  return c
}

vi.mock('@/config/db', () => ({
  db: (table: string) =>
    chain(() => {
      if (table === 'bill_invoices') return h.invoice
      if (table === 'bill_documents') return h.doc
      return { name: 'עסק' }
    }),
}))
vi.mock('@/db/billing/documents', () => ({
  markDocumentReady: h.ready,
  markDocumentFailed: h.failed,
  createPendingDocument: h.create,
  getPendingDocumentForInvoice: h.pending,
  hasReadyDocument: h.hasReady,
  closeStaleRenders: h.closeStale,
  appendDocumentDiagStep: vi.fn(async () => undefined),
}))
vi.mock('@/db/billing/issuer', () => ({ getIssuerForRender: async () => null }))
vi.mock('@/lib/billing/issuer/resolveForRender', () => ({ resolveIssuerForRender: () => null }))
vi.mock('@/lib/billing/pdf/renderInvoicePdf', () => ({ renderInvoicePdf: h.render }))
vi.mock('@/lib/billing/pdf/diag', () => ({ diagDb: vi.fn(async () => undefined) }))
vi.mock('@/lib/requireUser', () => ({ requireProductAccess: async () => ({ id: 1, agencyId: 7 }) }))
vi.mock('@/lib/storage/objects', async (original) => ({
  ...(await original<typeof import('@/lib/storage/objects')>()),
  putObject: h.put,
  headObject: h.head,
}))

import { renderAndStoreInvoicePdf } from '@/lib/billing/pdf/renderAndStore'
import { scheduleInvoicePdfRender } from '@/lib/billing/pdf/schedule'
import { getInvoicePdfStatusAction } from '@/actions/billing/documentStatus'

const INPUT = { documentId: 55, invoiceId: 9, agencyId: 7, objectPath: 'tenants/7/invoices/9/x.pdf', url: '/api/billing/invoice/9/download' }
const BYTES = new TextEncoder().encode('%PDF-1.7 חשבונית')

beforeEach(() => {
  vi.clearAllMocks()
  h.invoice = { id: 9, docState: 'issued' }
  h.render.mockResolvedValue(BYTES)
  h.put.mockResolvedValue(undefined)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('renderAndStoreInvoicePdf', () => {
  it('uploads the rendered bytes, then marks ready with their SHA-256', async () => {
    await renderAndStoreInvoicePdf(INPUT)
    const sha = createHash('sha256').update(BYTES).digest('hex')
    expect(h.put).toHaveBeenCalledWith({ key: INPUT.objectPath, body: BYTES, contentType: 'application/pdf', metadata: { sha256: sha } })
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ documentId: 55, contentHash: sha, byteSize: BYTES.byteLength, url: INPUT.url }))
    expect(h.failed).not.toHaveBeenCalled()
  })

  it.each([
    ['renderer timeout', () => h.render.mockRejectedValue(new PdfRenderError('timeout')), 'pdf_timeout'],
    ['renderer rejected the credentials', () => h.render.mockRejectedValue(new PdfRenderError('auth', 401)), 'pdf_auth'],
    ['renderer not configured', () => h.render.mockRejectedValue(new PdfRenderError('config_missing')), 'pdf_config_missing'],
    ['R2 outage on upload', () => h.put.mockRejectedValue(new StorageUnavailableError('InternalError', 500)), 'storage_unavailable'],
    ['R2 not configured', () => h.put.mockRejectedValue(new StorageConfigError(['R2_BUCKET_NAME'])), 'storage_config_missing'],
    ['an unexpected error', () => h.render.mockRejectedValue(new Error('boom')), 'render_error'],
  ])('%s ends in failed with a named reason, never stuck rendering', async (_label, arrange, reason) => {
    arrange()
    await renderAndStoreInvoicePdf(INPUT)
    expect(h.failed).toHaveBeenCalledWith(55, 7, reason)
    expect(h.ready).not.toHaveBeenCalled()
  })

  it('a draft is never rendered, and nothing is uploaded', async () => {
    h.invoice = { id: 9, docState: 'draft' }
    await renderAndStoreInvoicePdf(INPUT)
    expect(h.failed).toHaveBeenCalledWith(55, 7, 'invoice_is_draft')
    expect(h.render).not.toHaveBeenCalled()
    expect(h.put).not.toHaveBeenCalled()
  })

  it('an invoice outside the agency is not found', async () => {
    h.invoice = null
    await renderAndStoreInvoicePdf(INPUT)
    expect(h.failed).toHaveBeenCalledWith(55, 7, 'invoice_not_found')
  })
})

describe('scheduleInvoicePdfRender is idempotent', () => {
  const schedule = (force = false) => scheduleInvoicePdfRender({ invoiceId: 9, agencyId: 7, force })

  it('a ready document is left alone', async () => {
    h.hasReady.mockResolvedValue(true)
    await schedule()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('a render in flight is not started twice', async () => {
    h.hasReady.mockResolvedValue(false)
    h.pending.mockResolvedValue({ createdAt: new Date() })
    await schedule()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('a stale render does not block a new one, and is closed rather than left behind', async () => {
    h.hasReady.mockResolvedValue(false)
    h.pending.mockResolvedValue({ createdAt: new Date(Date.now() - 10 * 60_000) })
    await schedule()
    expect(h.closeStale).toHaveBeenCalledTimes(1)
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('even force does not start a second render while one is in flight', async () => {
    h.pending.mockResolvedValue({ createdAt: new Date() })
    await schedule(true)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('retrying after a failure is a new row under a new key', async () => {
    h.pending.mockResolvedValue(null)
    await schedule(true)
    await schedule(true)
    const [first, second] = h.create.mock.calls.map((c) => (c[0] as { path: string }).path)
    expect(first).not.toBe(second)
  })

  it('force renders over a ready document, into a tenant key, recording the authenticated route', async () => {
    h.hasReady.mockResolvedValue(true)
    h.pending.mockResolvedValue(null)
    await schedule(true)
    const row = h.create.mock.calls[0][0] as { path: string; url: string }
    expect(row.path).toMatch(/^tenants\/7\/invoices\/9\/[0-9a-f-]{36}\.pdf$/)
    expect(row.url).toBe('/api/billing/invoice/9/download')
    await vi.waitFor(() => expect(h.ready).toHaveBeenCalled())
  })

  it('never throws into the action that issued the invoice', async () => {
    h.hasReady.mockRejectedValue(new Error('db down'))
    await expect(schedule()).resolves.toBeUndefined()
  })
})

describe('getInvoicePdfStatusAction: no indefinite rendering', () => {
  const doc = (ageMs: number) => ({ id: 55, invoiceId: 9, agencyId: 7, status: 'rendering', url: INPUT.url, path: INPUT.objectPath, errorReason: null, createdAt: new Date(Date.now() - ageMs) })
  const FRESH = 10_000
  const STALE = 3 * 60_000

  it('an object already stored closes the row as ready', async () => {
    h.doc = doc(FRESH)
    h.head.mockResolvedValue({ size: 5, contentType: 'application/pdf', etag: 'e', metadata: { sha256: 'abc' } })
    await expect(getInvoicePdfStatusAction(9)).resolves.toMatchObject({ status: 'ready' })
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ contentHash: 'abc', byteSize: 5 }))
  })

  it('a young render with no object keeps rendering', async () => {
    h.doc = doc(FRESH)
    h.head.mockRejectedValue(new StorageNotFoundError())
    await expect(getInvoicePdfStatusAction(9)).resolves.toMatchObject({ status: 'rendering' })
    expect(h.failed).not.toHaveBeenCalled()
  })

  it.each([
    ['no object', new StorageNotFoundError(), 'render_timeout'],
    ['an R2 outage', new StorageUnavailableError('AccessDenied', 403), 'storage_unavailable'],
    ['missing configuration', new StorageConfigError(['R2_BUCKET_NAME']), 'storage_config_missing'],
  ])('a stale render with %s is closed as failed', async (_label, err, reason) => {
    h.doc = doc(STALE)
    h.head.mockRejectedValue(err)
    await expect(getInvoicePdfStatusAction(9)).resolves.toEqual({ status: 'failed', url: null, errorReason: reason })
    expect(h.failed).toHaveBeenCalledWith(55, 7, reason)
  })

  it('a stale render with no recorded path cannot stay rendering', async () => {
    h.doc = { ...doc(STALE), path: null }
    await expect(getInvoicePdfStatusAction(9)).resolves.toEqual({ status: 'failed', url: null, errorReason: 'render_timeout' })
    expect(h.head).not.toHaveBeenCalled()
  })

  it('a terminal row answers without contacting R2', async () => {
    h.doc = { ...doc(STALE), status: 'failed', errorReason: 'legacy_storage_retired' }
    await expect(getInvoicePdfStatusAction(9)).resolves.toMatchObject({ status: 'failed', errorReason: 'legacy_storage_retired' })
    expect(h.head).not.toHaveBeenCalled()
  })
})
