import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A quote's PDF, against a real (local test) PostgreSQL: a real quote made through
 * the webhook → worker → card → tap path, then the real claim, job, notice and
 * sweep. Only the model, the renderer, R2 and Meta are stood in for, and `fetch`
 * is blocked, so nothing can leave this machine.
 *
 * NOTE: over the 250-line soft limit on purpose, like quotes.db.test.ts: one flat
 * list of independent scenarios over one shared harness.
 */
const h = vi.hoisted(() => ({ agent: true, jobs: [] as (() => Promise<void>)[], afterThrows: false }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => h.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (job: () => Promise<void>) => {
    if (h.afterThrows) throw new Error('outside a request scope')
    h.jobs.push(job)
  },
}))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { startQuotePdf } from '@/lib/waAssistant/quotes/pdfJob'
import { notifyOwnerOfQuotePdf, quoteDownloadLink } from '@/lib/waAssistant/quotes/pdfNotice'
import { sweepQuotePdfs } from '@/lib/waAssistant/quotes/pdfSweep'
import { QUOTE_RENDER_STALE_MS, markQuoteDocumentReady } from '@/db/quotes/documents'
import { PdfRenderError, renderPdfFromHtml } from '@/lib/pdf/renderer'
import { StorageUnavailableError } from '@/lib/storage/objects'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let seq = 0
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, ++seq])
const SHA = createHash('sha256').update(PDF).digest('hex')
const fetchGuard = vi.fn()

type Fixture = { quoteId: number; digits: string; userId: number; leadId: number; leadPhone: string }

function pdfDeps(over: { render?: unknown; put?: unknown } = {}) {
  const render = vi.fn(async (_html: string) => PDF)
  const put = vi.fn(async (_i: { key: string; body: Uint8Array; contentType: string; metadata?: Record<string, string> }) => undefined)
  const send = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.PDF_${++seq}` }))
  return { render, put, send, deps: { render: { render: (over.render ?? render) as never, put: (over.put ?? put) as never }, notice: { send: send as never } } }
}

/** A real quote, approved through the real path, with the PDF step not yet started. */
async function approvedQuote(): Promise<Fixture> {
  const u = await user(A, 'ADMIN')
  const digits = `9725000075${String(++seq).padStart(2, '0')}`
  await recipient(A, u, digits, undefined, 'v4')
  const leadPhone = `05277${String(10000 + ++seq)}`
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: leadPhone, agencyId: A, userId: u, createdById: u, lead: true, status: 'new' }).returning('id')
  const leadId = Number(c.id)
  const answer = {
    ok: true as const,
    answer: { headline: 'h', claims: [], unknown: null, proposedAction: { actionType: 'create_quote', args: { clientId: leadId, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${leadId}`] } },
    evidence: [{ kind: 'lead', refId: String(leadId) }],
    steps: 2,
    stopReason: 'answered' as const,
    investigationId: `inv_pdf_${++seq}`,
    costUsd: 0.01,
  }
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.X_${++seq}` }))
  const deps = { runAgent: (async () => answer) as never, sendText: sendText as never, typing: (async () => undefined) as never, quotes: { decide: { startPdf: (async () => 'skipped') as never } } }
  const msg = (extra: Record<string, unknown>) => processPlatformMessage({ id: `wamid.__pdf_${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), ...extra } as never)
  await msg({ type: 'text', text: { body: 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ' } })
  await runWaAssistantWorker({}, deps)
  const approve = (sendText.mock.calls.at(-1)![0] as { buttons: { id: string }[] }).buttons[0].id
  await msg({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: approve, title: 'x' } } })
  await runWaAssistantWorker({}, deps)
  const q = await db('sales_quotes').where({ agencyId: A, leadId }).first('id')
  return { quoteId: Number(q.id), digits, userId: u, leadId, leadPhone }
}

const docs = (quoteId: number) => db('sales_quote_documents').where({ quoteId }).orderBy('id').select('status', 'isCurrent', 'path', 'contentHash', 'byteSize', 'failureReason', 'createdAt')
const metaOf = async (quoteId: number) => ((await db('sales_quotes').where({ id: quoteId }).first('metadata')) as { metadata: Record<string, any> }).metadata
const countQuotes = async () => Number((await db('sales_quotes').where({ agencyId: A }).count('id as n').first())!.n)
const start = (f: Fixture, deps: ReturnType<typeof pdfDeps>['deps'], extra: { nowMs?: number } = {}) => startQuotePdf({ agencyId: A, quoteId: f.quoteId, renderedByUserId: f.userId, inline: true, deps, ...extra })
const ageRendering = (quoteId: number) => db('sales_quote_documents').where({ quoteId, status: 'rendering' }).update({ createdAt: new Date(Date.now() - QUOTE_RENDER_STALE_MS - 1000) })

beforeAll(async () => {
  A = await agency('__wa_qpdf__')
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id = ?`, [A])
  await db('bill_tax_rates').where({ agencyId: A }).del()
  await db('bill_tax_rates').insert({ agencyId: A, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('sales_quotes').where({ agencyId: A }).del()
  await db('bill_numbering_sequences').where({ agencyId: A }).del()
  await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  h.jobs.length = 0
  h.afterThrows = false
  fetchGuard.mockReset()
  vi.stubGlobal('fetch', fetchGuard)
  process.env.WA_ASSISTANT_AGENCY_IDS = String(A)
  process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = String(A)
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  vi.unstubAllGlobals()
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN']) delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('sales_quotes').where({ agencyId: A }).del()
  await db('bill_numbering_sequences').where({ agencyId: A }).del()
  await db('bill_tax_rates').where({ agencyId: A }).del()
  await db('analytics_events').where({ agencyId: A }).del()
  await db('clients').where({ agencyId: A }).del()
  await cleanup()
})

describe('render and store', () => {
  it('hands the real document to the renderer, stores it privately, records hash and size', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    expect(await start(f, p.deps)).toBe('started')
    const html = p.render.mock.calls[0][0]
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('דוד כהן')
    expect(html).toContain('₪18,500.00')
    expect(html).toContain('₪2,822.03')
    expect(html).not.toContain('בתוקף עד')
    const put = p.put.mock.calls[0][0]
    expect(put.key).toMatch(new RegExp(`^tenants/${A}/quotes/${f.quoteId}/[0-9a-f-]{36}\\.pdf$`))
    expect(put.contentType).toBe('application/pdf')
    expect(put.metadata).toEqual({ sha256: SHA })
    const [d] = await docs(f.quoteId)
    expect(d).toMatchObject({ status: 'ready', isCurrent: true, path: put.key, contentHash: SHA, failureReason: null })
    expect(Number(d.byteSize)).toBe(PDF.byteLength)
  })

  it('a current PDF is left alone', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    await start(f, p.deps)
    expect(await start(f, p.deps)).toBe('skipped')
    expect(p.render).toHaveBeenCalledTimes(1)
    expect(await docs(f.quoteId)).toHaveLength(1)
  })

  it('concurrent starts run one render', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    const results = await Promise.all(Array.from({ length: 6 }, () => start(f, p.deps)))
    expect(results.filter((r) => r === 'started')).toHaveLength(1)
    expect(p.render).toHaveBeenCalledTimes(1)
    const rows = await docs(f.quoteId)
    expect(rows).toHaveLength(1)
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)
  })

  it('a render closed as stale cannot become current when it finally finishes', async () => {
    const f = await approvedQuote()
    let release!: () => void
    const held = new Promise<Uint8Array>((r) => (release = () => r(PDF)))
    const p = pdfDeps({ render: () => held })
    const running = start(f, p.deps)
    await vi.waitFor(async () => expect(await docs(f.quoteId)).toHaveLength(1))
    await ageRendering(f.quoteId)
    const q = pdfDeps()
    await start(f, q.deps)
    release()
    await running
    const rows = await docs(f.quoteId)
    expect(rows.map((d) => d.status)).toEqual(['failed', 'ready'])
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)
    expect(p.send).not.toHaveBeenCalled()
    expect(q.send).toHaveBeenCalledTimes(1)
    expect(await markQuoteDocumentReady({ documentId: 0, agencyId: A, quoteId: f.quoteId, contentHash: SHA, byteSize: 1 })).toBe(false)
  })
})

describe('failure keeps the quote and retries safely', () => {
  it('an R2 failure: failed row, quote untouched, nothing said yet, a retry succeeds as the one current PDF', async () => {
    const f = await approvedQuote()
    const before = await db('sales_quotes').where({ id: f.quoteId }).first('status', 'quoteNumber', 'totalAmount')
    const bad = pdfDeps({ put: async () => { throw new StorageUnavailableError('SlowDown', 503) } })
    await start(f, bad.deps)
    expect(await docs(f.quoteId)).toMatchObject([{ status: 'failed', failureReason: 'storage_unavailable', isCurrent: false }])
    expect(bad.send).not.toHaveBeenCalled()
    expect(await db('sales_quotes').where({ id: f.quoteId }).first('status', 'quoteNumber', 'totalAmount')).toEqual(before)

    const good = pdfDeps()
    await sweepQuotePdfs({ deps: good.deps })
    const rows = await docs(f.quoteId)
    expect(rows.map((d) => d.status)).toEqual(['failed', 'ready'])
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)
    expect(good.send).toHaveBeenCalledTimes(1)
    expect(await countQuotes()).toBe(1)
  })

  it('a render failure names its reason', async () => {
    const f = await approvedQuote()
    await start(f, pdfDeps({ render: async () => { throw new PdfRenderError('timeout') } }).deps)
    expect(await docs(f.quoteId)).toMatchObject([{ status: 'failed', failureReason: 'pdf_timeout' }])
  })

  it('out of attempts: the owner hears once, the quote stands, and no more renders run', async () => {
    const f = await approvedQuote()
    const bad = pdfDeps({ render: async () => { throw new PdfRenderError('network') } })
    await start(f, bad.deps)
    await sweepQuotePdfs({ deps: bad.deps })
    expect(bad.send).not.toHaveBeenCalled()
    await sweepQuotePdfs({ deps: bad.deps })
    expect(bad.send).toHaveBeenCalledTimes(1)
    const body = bad.send.mock.calls[0][0].body as string
    expect(body).toContain('לא הצלחתי להכין את קובץ ה-PDF')
    expect(body).toContain('ההצעה עצמה נשמרה')
    expect(body).toContain('לא נשלחה ללקוח')
    await sweepQuotePdfs({ deps: bad.deps })
    await sweepQuotePdfs({ deps: bad.deps })
    expect(bad.send).toHaveBeenCalledTimes(1)
    expect(await docs(f.quoteId)).toHaveLength(3)
    expect(await countQuotes()).toBe(1)
    expect((await db('sales_quotes').where({ id: f.quoteId }).first('status')).status).toBe('ready')
  })

  it('a failure a retry cannot fix tells the owner at once', async () => {
    const f = await approvedQuote()
    const bad = pdfDeps({ render: async () => { throw new PdfRenderError('config_missing') } })
    await start(f, bad.deps)
    expect(bad.send).toHaveBeenCalledTimes(1)
    await sweepQuotePdfs({ deps: bad.deps })
    expect(await docs(f.quoteId)).toHaveLength(1)
  })

  it('a process that died mid-render is closed as stale and retried', async () => {
    const f = await approvedQuote()
    await db('sales_quote_documents').insert({ agencyId: A, quoteId: f.quoteId, status: 'rendering', path: 'tenants/x.pdf' })
    const p = pdfDeps()
    await sweepQuotePdfs({ deps: p.deps })
    expect(p.render).not.toHaveBeenCalled() // still live: not ours to touch
    await ageRendering(f.quoteId)
    await sweepQuotePdfs({ deps: p.deps })
    expect((await docs(f.quoteId)).map((d) => d.failureReason ?? d.status)).toEqual(['stale_render', 'ready'])
  })
})

describe('background execution', () => {
  it('the render runs after the reply, through after(), not before startQuotePdf returns', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    expect(await startQuotePdf({ agencyId: A, quoteId: f.quoteId, renderedByUserId: f.userId, deps: p.deps })).toBe('started')
    expect(p.render).not.toHaveBeenCalled()
    expect(await docs(f.quoteId)).toMatchObject([{ status: 'rendering', isCurrent: false }])
    expect(h.jobs).toHaveLength(1)
    await h.jobs[0]()
    expect(await docs(f.quoteId)).toMatchObject([{ status: 'ready', isCurrent: true }])
  })

  it('outside a request scope it still runs, without being awaited', async () => {
    h.afterThrows = true
    const f = await approvedQuote()
    const p = pdfDeps()
    await startQuotePdf({ agencyId: A, quoteId: f.quoteId, renderedByUserId: f.userId, deps: p.deps })
    await vi.waitFor(async () => expect(await docs(f.quoteId)).toMatchObject([{ status: 'ready' }]))
    await vi.waitFor(() => expect(p.send).toHaveBeenCalledTimes(1))
  })

  it('never throws into the approval', async () => {
    const r = await startQuotePdf({ agencyId: A, quoteId: Number.NaN, renderedByUserId: null, deps: pdfDeps().deps })
    expect(r).toBe('error')
  })

  it('the sweep does no work with the switch off', async () => {
    const f = await approvedQuote()
    delete process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS
    const p = pdfDeps()
    expect(await sweepQuotePdfs({ deps: p.deps })).toEqual({ rendered: 0, notified: 0 })
    expect(await docs(f.quoteId)).toHaveLength(0)
  })

  it('one render a tick, however many quotes wait', async () => {
    await approvedQuote()
    await approvedQuote()
    const p = pdfDeps()
    expect((await sweepQuotePdfs({ deps: p.deps })).rendered).toBe(1)
    expect(p.render).toHaveBeenCalledTimes(1)
  })
})

describe('the WhatsApp follow-up', () => {
  it('goes to the owner only, with number, exact total, an opaque link, and "not sent to the customer"', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    await start(f, p.deps)
    expect(p.send).toHaveBeenCalledTimes(1)
    const sent = p.send.mock.calls[0][0]
    expect(sent.toE164).toBe(`+${f.digits}`)
    expect(sent.toE164).not.toContain(f.leadPhone)
    expect(sent.buttons).toBeUndefined()
    for (const s of ['*קובץ הצעת המחיר מוכן*', 'מספר הצעה: 1', 'סה"כ: ₪18,500.00', quoteDownloadLink(SHA), 'ההצעה לא נשלחה ללקוח.']) expect(sent.body).toContain(s)
    expect(sent.body).not.toMatch(new RegExp(`/api/quotes/${f.quoteId}/`))
    expect(sent.body).not.toContain('tenants/')
    expect((await metaOf(f.quoteId)).pdfNotice).toEqual({ kind: 'ready', state: 'sent' })
    expect(fetchGuard).not.toHaveBeenCalled()
  })

  it('concurrent notices send one message', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    const results = await Promise.all(Array.from({ length: 6 }, () => notifyOwnerOfQuotePdf({ agencyId: A, quoteId: f.quoteId, notice: { kind: 'ready', handle: SHA }, deps: p.deps.notice })))
    expect(p.send).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r === 'sent')).toHaveLength(1)
    expect(results.filter((r) => r === 'already_claimed')).toHaveLength(5)
  })

  it('an unknown send outcome is never resent', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    p.send.mockResolvedValueOnce({ kind: 'unknown', reason: 'timeout' } as never)
    await start(f, p.deps)
    expect((await metaOf(f.quoteId)).pdfNotice).toEqual({ kind: 'ready', state: 'unknown' })
    await sweepQuotePdfs({ deps: p.deps })
    expect(p.send).toHaveBeenCalledTimes(1)
  })

  it('a lost notice is finished by the sweep, once', async () => {
    const f = await approvedQuote()
    const p = pdfDeps()
    const row = await db('sales_quote_documents').insert({ agencyId: A, quoteId: f.quoteId, status: 'rendering', path: 'tenants/x.pdf' }).returning('id')
    await markQuoteDocumentReady({ documentId: Number(row[0].id), agencyId: A, quoteId: f.quoteId, contentHash: SHA, byteSize: 9 })
    await sweepQuotePdfs({ deps: p.deps })
    await sweepQuotePdfs({ deps: p.deps })
    expect(p.send).toHaveBeenCalledTimes(1)
    expect(p.render).not.toHaveBeenCalled()
  })

  it('a recipient who is no longer active gets nothing, and the PDF still exists', async () => {
    const f = await approvedQuote()
    await db('owner_whatsapp_recipients').where({ agencyId: A }).update({ status: 'opted_out' })
    const p = pdfDeps()
    await start(f, p.deps)
    expect(p.send).not.toHaveBeenCalled()
    expect((await metaOf(f.quoteId)).pdfNotice).toEqual({ kind: 'ready', state: 'not_eligible' })
    expect(await docs(f.quoteId)).toMatchObject([{ status: 'ready' }])
  })

  it('a quote that did not come from WhatsApp notifies nobody', async () => {
    const f = await approvedQuote()
    await db('sales_quotes').where({ id: f.quoteId }).update({ metadata: JSON.stringify({ source: 'automation' }) })
    const p = pdfDeps()
    expect(await notifyOwnerOfQuotePdf({ agencyId: A, quoteId: f.quoteId, notice: { kind: 'failed' }, deps: p.deps.notice })).toBe('not_eligible')
    expect(p.send).not.toHaveBeenCalled()
  })

  it('switch off after approval: no follow-up', async () => {
    const f = await approvedQuote()
    delete process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS
    const p = pdfDeps()
    await start(f, p.deps)
    expect(p.send).not.toHaveBeenCalled()
  })
})

describe('Cloudflare failure responses, through the real renderer client (fetch stubbed)', () => {
  const OK_PDF = () => new Response(Buffer.from('%PDF-1.7 stub'), { status: 200, headers: { 'content-type': 'application/pdf' } })
  const real = () => pdfDeps({ render: renderPdfFromHtml })
  const script = (...responses: (() => Response | Promise<Response>)[]) => {
    fetchGuard.mockReset()
    fetchGuard.mockImplementation(async () => (responses.length > 1 ? responses.shift()! : responses[0])())
  }
  const reasons = async (quoteId: number) => (await docs(quoteId)).map((d) => d.failureReason ?? d.status)
  const failedNotice = (send: ReturnType<typeof pdfDeps>['send']) => send.mock.calls.filter((c) => String(c[0].body).includes('לא הצלחתי להכין את קובץ ה-PDF'))
  const readyNotice = (send: ReturnType<typeof pdfDeps>['send']) => send.mock.calls.filter((c) => String(c[0].body).includes('/api/quotes/'))
  const quoteStands = async (quoteId: number) => expect((await db('sales_quotes').where({ id: quoteId }).first('status')).status).toBe('ready')

  beforeEach(() => {
    vi.stubEnv('PDF_RENDERER', 'cloudflare')
    vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32))
    vi.stubEnv('CLOUDFLARE_BROWSER_RENDERING_API_TOKEN', 'stub-token')
    vi.stubEnv('PDF_RENDER_TIMEOUT_MS', '30000')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('the request goes to Cloudflare Browser Run, with the bearer token', async () => {
    const f = await approvedQuote()
    const d = real()
    script(OK_PDF)
    await start(f, d.deps)
    const [url, init] = fetchGuard.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/browser-run/pdf`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer stub-token')
  })

  it.each([401, 403])('%i: pdf_auth is permanent: no retry, and the owner hears once, at once', async (status) => {
    const f = await approvedQuote()
    const d = real()
    script(() => new Response('{"success":false}', { status }))
    await start(f, d.deps)
    expect(await reasons(f.quoteId)).toEqual(['pdf_auth'])
    expect(failedNotice(d.send)).toHaveLength(1)
    await sweepQuotePdfs({ deps: d.deps })
    await sweepQuotePdfs({ deps: d.deps })
    expect(fetchGuard).toHaveBeenCalledTimes(1)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.put).not.toHaveBeenCalled()
    await quoteStands(f.quoteId)
  })

  it('429 with a short Retry-After: waits once inside the same attempt and succeeds, with no failed row', async () => {
    const f = await approvedQuote()
    const d = real()
    script(() => new Response('', { status: 429, headers: { 'retry-after': '1' } }), OK_PDF)
    await start(f, d.deps)
    expect(fetchGuard).toHaveBeenCalledTimes(2)
    expect(await reasons(f.quoteId)).toEqual(['ready'])
    expect(readyNotice(d.send)).toHaveLength(1)
    expect(failedNotice(d.send)).toHaveLength(0)
  })

  it('429 with a Retry-After too long to wait: fails as rate_limited, says nothing, and the sweep retries', async () => {
    const f = await approvedQuote()
    const d = real()
    script(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }), OK_PDF)
    await start(f, d.deps)
    expect(fetchGuard).toHaveBeenCalledTimes(1)
    expect(await reasons(f.quoteId)).toEqual(['pdf_rate_limited'])
    expect(d.send).not.toHaveBeenCalled()
    await sweepQuotePdfs({ deps: d.deps })
    expect(await reasons(f.quoteId)).toEqual(['pdf_rate_limited', 'ready'])
    expect(readyNotice(d.send)).toHaveLength(1)
  })

  it('429 twice: the one wait is spent, and the attempt fails as rate_limited', async () => {
    const f = await approvedQuote()
    const d = real()
    script(() => new Response('', { status: 429, headers: { 'retry-after': '1' } }))
    await start(f, d.deps)
    expect(fetchGuard).toHaveBeenCalledTimes(2)
    expect(await reasons(f.quoteId)).toEqual(['pdf_rate_limited'])
  })

  it('500: three attempts, one notice on the last, and then silence', async () => {
    const f = await approvedQuote()
    const d = real()
    script(() => new Response('oops', { status: 500 }))
    await start(f, d.deps)
    await sweepQuotePdfs({ deps: d.deps })
    expect(d.send).not.toHaveBeenCalled()
    await sweepQuotePdfs({ deps: d.deps })
    expect(await reasons(f.quoteId)).toEqual(['pdf_bad_status', 'pdf_bad_status', 'pdf_bad_status'])
    expect(failedNotice(d.send)).toHaveLength(1)
    await sweepQuotePdfs({ deps: d.deps })
    await sweepQuotePdfs({ deps: d.deps })
    expect(fetchGuard).toHaveBeenCalledTimes(3)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.put).not.toHaveBeenCalled()
    await quoteStands(f.quoteId)
  })

  it.each([
    ['invalid JSON', '{"success":'],
    ['a JSON error', '{"success":false,"errors":[{"code":1000}]}'],
    ['HTML', '<html>not a pdf</html>'],
    ['an empty body', ''],
  ])('200 with %s: never stored as a PDF, and retried', async (_what, body) => {
    const f = await approvedQuote()
    const d = real()
    script(() => new Response(body, { status: 200 }), OK_PDF)
    await start(f, d.deps)
    expect(await reasons(f.quoteId)).toEqual(['pdf_invalid_output'])
    expect(d.put).not.toHaveBeenCalled()
    expect(d.send).not.toHaveBeenCalled()
    await sweepQuotePdfs({ deps: d.deps })
    expect(await reasons(f.quoteId)).toEqual(['pdf_invalid_output', 'ready'])
    expect(d.put).toHaveBeenCalledTimes(1)
    expect(readyNotice(d.send)).toHaveLength(1)
  })

  it('a client-side timeout: pdf_timeout, retried, and one notice when attempts run out', async () => {
    vi.stubEnv('PDF_RENDER_TIMEOUT_MS', '30')
    const f = await approvedQuote()
    const d = real()
    fetchGuard.mockReset()
    fetchGuard.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))))
    await start(f, d.deps)
    expect(await reasons(f.quoteId)).toEqual(['pdf_timeout'])
    await sweepQuotePdfs({ deps: d.deps })
    await sweepQuotePdfs({ deps: d.deps })
    await sweepQuotePdfs({ deps: d.deps })
    expect(await reasons(f.quoteId)).toEqual(['pdf_timeout', 'pdf_timeout', 'pdf_timeout'])
    expect(fetchGuard).toHaveBeenCalledTimes(3)
    expect(failedNotice(d.send)).toHaveLength(1)
    expect(d.send).toHaveBeenCalledTimes(1)
    await quoteStands(f.quoteId)
  })
})
