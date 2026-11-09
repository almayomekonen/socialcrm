import { expect, it } from 'vitest'
import { db } from '@/config/db'
import { QUOTE_RENDER_STALE_MS } from '@/db/quotes/documents'
import { createQuoteSystem } from '@/db/quotes/createQuote'
import { readR2Config } from '@/lib/storage/config'
import { buildR2Client, deleteObject, listObjects } from '@/lib/storage/objects'
import { sweepQuotePdfs } from '@/lib/waAssistant/quotes/pdfSweep'
import { CLOUD_AGENCY } from './env'
import { USER, ctx, docsOf, leads, notice, quote, start, wallRefusals } from './harness'

/** Well-formed, so the answer is about the token rather than its shape. */
const INVALID_TOKEN = 'invalidquotestage2harnesstokennotreal000'

async function withEnv(name: string, value: string, run: () => Promise<void>): Promise<void> {
  const saved = process.env[name]
  process.env[name] = value
  try {
    await run()
  } finally {
    process.env[name] = saved
  }
}
const storedUnder = async (quoteId: number) => (await listObjects({ prefix: `tenants/${CLOUD_AGENCY}/quotes/${quoteId}/` })).objects.length
const quoteStatus = async (id: number) => (await db('sales_quotes').where({ id }).first('status')).status

export function failureCases(): void {
  it('an invalid Browser Run token is an auth failure, stores nothing, and the quote stands', async () => {
    const q = await quote(1)
    await withEnv('CLOUDFLARE_BROWSER_RENDERING_API_TOKEN', INVALID_TOKEN, async () => {
      expect(await start(q.quoteId)).toBe('started')
    })
    expect(await docsOf(q.quoteId)).toMatchObject([{ status: 'failed', isCurrent: false, failureReason: 'pdf_auth' }])
    expect(await storedUnder(q.quoteId)).toBe(0)
    expect(await quoteStatus(q.quoteId)).toBe('ready')
  }, 200_000)

  // This proves our client aborts on time. It says nothing about a timeout on Cloudflare's side.
  it('a client-side timeout aborts the request, is classified, and stores nothing', async () => {
    const q = await quote(1)
    // The renderer starts its timeout before fetching: a wait for the 11-second gap would use up the 1ms.
    await ctx.limiter.waitForSlot()
    await withEnv('PDF_RENDER_TIMEOUT_MS', '1', async () => {
      expect(await start(q.quoteId)).toBe('started')
    })
    expect(await docsOf(q.quoteId)).toMatchObject([{ status: 'failed', isCurrent: false, failureReason: 'pdf_timeout' }])
    expect(await storedUnder(q.quoteId)).toBe(0)
    expect(await quoteStatus(q.quoteId)).toBe('ready')
  }, 200_000)

  it('an upload failure is retried into one current PDF, with no duplicate quote or document', async () => {
    const automationKey = `cloud:retry:${Date.now()}`
    const q = await quote(1, { sweepable: true, automationKey })
    await start(q.quoteId, { render: { put: async () => { throw new Error('injected upload failure') } } })
    expect(await docsOf(q.quoteId)).toMatchObject([{ status: 'failed', isCurrent: false }])
    await sweepQuotePdfs({ deps: { notice } })
    const rows = await docsOf(q.quoteId)
    expect(rows.map((d) => d.status)).toEqual(['failed', 'ready'])
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)

    const requests = ctx.limiter.requests
    expect(await start(q.quoteId)).toBe('skipped')
    await sweepQuotePdfs({ deps: { notice } })
    expect(ctx.limiter.requests).toBe(requests)
    expect(await docsOf(q.quoteId)).toHaveLength(2)

    const replay = await createQuoteSystem({ agencyId: CLOUD_AGENCY, leadId: leads.main, createdByUserId: USER, title: 'שיפוץ מטבח כולל ארונות', lines: [{ title: 'פריט', quantity: 1, unitAmount: 1000 }], priceBasis: 'excl_vat', validityDays: 30, finalize: true, automationKey })
    expect(replay).toMatchObject({ ok: true, created: false, quoteId: q.quoteId, quoteNumber: q.quoteNumber })
    expect(await db('sales_quotes').where({ agencyId: CLOUD_AGENCY, automationKey })).toHaveLength(1)
  }, 200_000)

  it('a render that died is closed as stale and recovered by the sweep', async () => {
    const q = await quote(1, { sweepable: true })
    await db('sales_quote_documents').insert({ agencyId: CLOUD_AGENCY, quoteId: q.quoteId, status: 'rendering', path: `tenants/${CLOUD_AGENCY}/quotes/${q.quoteId}/dead.pdf`, createdAt: new Date(Date.now() - QUOTE_RENDER_STALE_MS - 1000) })
    await sweepQuotePdfs({ deps: { notice } })
    expect((await docsOf(q.quoteId)).map((d) => d.failureReason ?? d.status)).toEqual(['stale_render', 'ready'])
  }, 200_000)

  it('each S3 call is one HTTP attempt, so the limits count every request', async () => {
    expect(await buildR2Client(readR2Config()).config.maxAttempts()).toBe(1)
  })

  it('the object wall refuses a key outside the synthetic tenants, before it reaches the bucket', async () => {
    const before = wallRefusals.length
    await expect(deleteObject('tenants/5/quotes/1/customer.pdf')).rejects.toBeTruthy()
    await expect(deleteObject('tenants/998010/quotes/1/near-miss.pdf')).rejects.toBeTruthy()
    expect(wallRefusals.length).toBe(before + 2)
  })
}
