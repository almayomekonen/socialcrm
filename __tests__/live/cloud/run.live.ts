import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * A quote's PDF through the real code: claim, real renderer client, real R2
 * client, persistence, retrieval, authenticated download, retry and recovery.
 * The same checks run in both modes; only the far end differs (see ./env.ts).
 */
const h = vi.hoisted(() => ({ cookie: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined), delete: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f, cacheTag: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ status: 'PAID', hasAccess: true }) }))

import { db } from '@/config/db'
import { encrypt } from '@/db/auth'
import { createQuoteSystem } from '@/db/quotes/createQuote'
import { QUOTE_RENDER_STALE_MS } from '@/db/quotes/documents'
import { GET } from '@/app/api/quotes/[quoteId]/download/route'
import { deleteObject, getObjectBytes, headObject, listObjects } from '@/lib/storage/objects'
import { startQuotePdf } from '@/lib/waAssistant/quotes/pdfJob'
import { sweepQuotePdfs } from '@/lib/waAssistant/quotes/pdfSweep'
import { CLOUD_AGENCY, CLOUD_EXEMPT_AGENCY, type CloudContext } from './env'
import { filenameFrom, installDryBucket, pdfText } from './helpers'

const ctx = (globalThis as unknown as { __quoteCloud: CloudContext }).__quoteCloud
const notice = { send: vi.fn(async () => ({ kind: 'sent' as const, wamid: 'wamid.CLOUD' })) as never }
const USER = 998010
const EXEMPT_USER = 998020
const REP_WITH_LEAD = 998011
const REP_WITHOUT_LEAD = 998012
const TENANTS = [CLOUD_AGENCY, CLOUD_EXEMPT_AGENCY]
let leadId = 0
let exemptLeadId = 0
let repLeadId = 0
let seq = 0

type QuoteOver = { discountPercent?: number; unitAmount?: number; priceBasis?: 'incl_vat' | 'excl_vat' | null; exempt?: boolean; leadId?: number; lineTitle?: string }
const quote = async (lines: number, over: QuoteOver = {}) => {
  const unitAmount = over.unitAmount ?? 1000
  const r = await createQuoteSystem({
    agencyId: over.exempt ? CLOUD_EXEMPT_AGENCY : CLOUD_AGENCY,
    leadId: over.leadId ?? (over.exempt ? exemptLeadId : leadId),
    createdByUserId: over.exempt ? EXEMPT_USER : USER,
    title: 'שיפוץ מטבח כולל ארונות',
    lines: Array.from({ length: lines }, (_, i) => ({ title: over.lineTitle ?? `פריט בדיקה מספר ${i + 1}`, quantity: 1, unitAmount, discountAmount: over.discountPercent ? (unitAmount * over.discountPercent) / 100 : undefined })),
    priceBasis: over.priceBasis === undefined ? 'excl_vat' : over.priceBasis,
    validityDays: 30,
    finalize: true,
    automationKey: `cloud:${++seq}:${Date.now()}`,
    metadata: { source: 'wa_assistant', actionId: `act_cloud_${seq}` },
  })
  if (r.ok === false) throw new Error('quote not created')
  return r
}
const docsOf = (quoteId: number) => db('sales_quote_documents').where({ quoteId }).orderBy('id').select('status', 'isCurrent', 'path', 'contentHash', 'byteSize', 'failureReason')
const start = (quoteId: number, deps: Record<string, unknown> = {}, agencyId = CLOUD_AGENCY) => startQuotePdf({ agencyId, quoteId, renderedByUserId: USER, inline: true, deps: { notice, ...deps } as never })
const open = (handle: string) => GET(new NextRequest(`https://crm.test/api/quotes/${handle}/download`), { params: Promise.resolve({ quoteId: handle }) })

/** Every object in the bucket, across pages. A failed listing throws: "could not look" is not "empty". */
async function allObjects(): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await listObjects({ prefix: '', cursor })
    keys.push(...page.objects.map((o) => o.key))
    cursor = page.nextCursor
  } while (cursor)
  return keys
}

beforeAll(async () => {
  if (ctx.mode === 'dry') installDryBucket()
  // A test bucket with anything in it may not be the bucket it claims to be.
  expect(await allObjects()).toEqual([])
  await db('agencies').insert({ id: CLOUD_AGENCY, name: 'עסק בדיקה סינתטי', plan: 'pro' } as never).onConflict('id').ignore()
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id = ?`, [CLOUD_AGENCY])
  await db('users').insert({ id: USER, agencyId: CLOUD_AGENCY, email: 'cloud@t.test', role: 'ADMIN', firstName: 'א', lastName: 'ב' } as never).onConflict('id').ignore()
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: '0501234567', agencyId: CLOUD_AGENCY, userId: USER, createdById: USER, lead: true, status: 'new' }).returning('id')
  leadId = Number(c.id)
  await db('bill_tax_rates').where({ agencyId: CLOUD_AGENCY }).del()
  await db('bill_tax_rates').insert({ agencyId: CLOUD_AGENCY, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
  await db('agencies').insert({ id: CLOUD_EXEMPT_AGENCY, name: 'עסק פטור סינתטי', plan: 'pro' } as never).onConflict('id').ignore()
  await db.raw(`UPDATE agencies SET "businessType" = 'exempt' WHERE id = ?`, [CLOUD_EXEMPT_AGENCY])
  await db('users').insert({ id: EXEMPT_USER, agencyId: CLOUD_EXEMPT_AGENCY, email: 'cloud-exempt@t.test', role: 'ADMIN', firstName: 'א', lastName: 'ב' } as never).onConflict('id').ignore()
  const [e] = await db('clients').insert({ firstName: 'רונית', lastName: 'לוי', phone: '0501234568', agencyId: CLOUD_EXEMPT_AGENCY, userId: EXEMPT_USER, createdById: EXEMPT_USER, lead: true, status: 'new' }).returning('id')
  exemptLeadId = Number(e.id)
  await db('users').insert([REP_WITH_LEAD, REP_WITHOUT_LEAD].map((id) => ({ id, agencyId: CLOUD_AGENCY, email: `r${id}@t.test`, role: 'AGNT', firstName: 'נ', lastName: String(id) })) as never).onConflict('id').ignore()
  const [r] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: '0501234569', agencyId: CLOUD_AGENCY, userId: REP_WITH_LEAD, createdById: REP_WITH_LEAD, lead: true, status: 'new' }).returning('id')
  repLeadId = Number(r.id)
  h.cookie = await encrypt({ id: USER, sv: 0, typ: 'session' })
}, 120_000)

afterAll(async () => {
  try {
    for (const agencyId of TENANTS) {
      const prefix = `tenants/${agencyId}/`
      for (const key of (await allObjects()).filter((k) => k.startsWith(prefix))) await deleteObject(key)
    }
    expect(await allObjects()).toEqual([])
  } finally {
    await db('sales_quotes').whereIn('agencyId', TENANTS).del()
    await db('bill_numbering_sequences').whereIn('agencyId', TENANTS).del()
    await db('bill_tax_rates').whereIn('agencyId', TENANTS).del()
    await db('clients').whereIn('agencyId', TENANTS).del()
    await db('users').whereIn('agencyId', TENANTS).del()
    await db('agencies').whereIn('id', TENANTS).del()
    ctx.guard.uninstall()
  }
  expect(ctx.guard.refusals).toEqual([])
}, 120_000)

describe(`quote PDF, cloud path (${ctx.mode})`, () => {
  it.each([[1, 1], [12, 1], [50, 2]])('%i lines: rendered, stored, and identical when read back', async (lines, minPages) => {
    const q = await quote(lines)
    expect(await start(q.quoteId)).toBe('started')
    const [d] = await docsOf(q.quoteId)
    expect(d).toMatchObject({ status: 'ready', isCurrent: true })
    expect(d.path).toMatch(new RegExp(`^tenants/${CLOUD_AGENCY}/quotes/${q.quoteId}/[0-9a-f-]{36}\\.pdf$`))
    const bytes = await getObjectBytes(d.path)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.contentHash)
    expect(Number(d.byteSize)).toBe(bytes.byteLength)
    const head = await headObject(d.path)
    expect(head.size).toBe(bytes.byteLength)
    expect(head.metadata.sha256).toBe(d.contentHash)
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
    const pdf = await pdfText(bytes)
    expect(pdf.pages).toBeGreaterThanOrEqual(minPages)
    expect(pdf.text).toContain('כהן')
  }, 200_000)

  const documentText = async (quoteId: number) => {
    const [d] = await docsOf(quoteId)
    expect(d.status).toBe('ready')
    return (await pdfText(await getObjectBytes(d.path))).text
  }

  it('a discount and a validity survive to the document', async () => {
    const q = await quote(2, { discountPercent: 10 })
    await start(q.quoteId)
    expect(q.totalAmount).toBe(2124)
    const text = await documentText(q.quoteId)
    for (const figure of ['200.00', '1,800.00', '324.00', '2,124.00']) expect(text).toContain(figure)
    const { validUntil } = (await db('sales_quotes').where({ id: q.quoteId }).first(db.raw(`to_char("expiresAt", 'DD/MM/YYYY') as "validUntil"`))) as { validUntil: string }
    expect(validUntil).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(text).toContain('בתוקף עד')
    expect(text).toContain(validUntil)
  }, 200_000)

  it('a VAT-inclusive quote shows the solved price, VAT and the stated total', async () => {
    const q = await quote(1, { unitAmount: 18500, priceBasis: 'incl_vat' })
    await start(q.quoteId)
    expect(q.totalAmount).toBe(18500)
    const text = await documentText(q.quoteId)
    for (const figure of ['15,677.97', '2,822.03', '18,500.00']) expect(text).toContain(figure)
  }, 200_000)

  it('an exempt business shows 0% VAT, says it is exempt, and is stored under its own tenant', async () => {
    const q = await quote(1, { unitAmount: 18500, priceBasis: null, exempt: true })
    expect(await start(q.quoteId, {}, CLOUD_EXEMPT_AGENCY)).toBe('started')
    const [d] = await docsOf(q.quoteId)
    expect(d.path.startsWith(`tenants/${CLOUD_EXEMPT_AGENCY}/quotes/`)).toBe(true)
    const text = await documentText(q.quoteId)
    expect(text).toContain('פטור')
    expect(text).toContain('0%')
    expect(text).toContain('18,500.00')
    expect(text).not.toContain('2,822.03')
  }, 200_000)

  it('the authenticated route redirects to a 60-second link that returns the same bytes', async () => {
    const q = await quote(1)
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    const res = await open(d.contentHash as string)
    expect(res.status).toBe(302)
    const location = res.headers.get('location') as string
    expect(new URL(location).searchParams.get('X-Amz-Expires')).toBe('60')
    const got = await fetch(location)
    expect(got.status).toBe(200)
    expect(createHash('sha256').update(new Uint8Array(await got.arrayBuffer())).digest('hex')).toBe(d.contentHash)
  }, 200_000)

  it('no session opens nothing', async () => {
    const saved = h.cookie
    h.cookie = undefined
    const res = await open('a'.repeat(64))
    h.cookie = saved
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/auth')
  })

  it('mixed Hebrew, digits and Latin: the fonts are embedded and the text survives', async () => {
    const q = await quote(1, { unitAmount: 1694.92, lineTitle: 'דלת 80×210 דגם X-200 (2 יחידות)' })
    await start(q.quoteId)
    const text = await documentText(q.quoteId)
    for (const part of ['דלת', 'יחידות', 'X-200', '1,694.92']) expect(text).toContain(part)
  }, 200_000)

  it('the download: the agency and lead rules hold, and R2 serves the Hebrew filename and the PDF type', async () => {
    const q = await quote(1, { leadId: repLeadId })
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    const as = async (id: number) => {
      h.cookie = await encrypt({ id, sv: 0, typ: 'session' })
      return open(d.contentHash as string)
    }
    try {
      for (const refused of [EXEMPT_USER, REP_WITHOUT_LEAD]) {
        const res = await as(refused)
        expect(res.status).toBe(404)
        expect(res.headers.get('location')).toBeNull()
      }
      const ok = await as(REP_WITH_LEAD)
      expect(ok.status).toBe(302)
      const got = await fetch(ok.headers.get('location') as string)
      expect(got.status).toBe(200)
      expect(got.headers.get('content-type')).toBe('application/pdf')
      const number = String(q.quoteNumber).padStart(5, '0')
      expect(filenameFrom(got.headers.get('content-disposition'))).toEqual({ utf8: `Quote-${number}-דוד_כהן.pdf`, ascii: `Quote-${number}-_______.pdf` })
      expect(createHash('sha256').update(new Uint8Array(await got.arrayBuffer())).digest('hex')).toBe(d.contentHash)
    } finally {
      h.cookie = await encrypt({ id: USER, sv: 0, typ: 'session' })
    }
  }, 200_000)

  it('an upload failure is recorded, and the cron sweep retries it into one current PDF', async () => {
    const q = await quote(1)
    await start(q.quoteId, { render: { put: async () => { throw new Error('injected upload failure') } } })
    expect(await docsOf(q.quoteId)).toMatchObject([{ status: 'failed', isCurrent: false }])
    await sweepQuotePdfs({ deps: { notice } })
    const rows = await docsOf(q.quoteId)
    expect(rows.map((d) => d.status)).toEqual(['failed', 'ready'])
    expect(rows.filter((d) => d.isCurrent)).toHaveLength(1)
  }, 200_000)

  it('a render that died is closed as stale and recovered by the sweep', async () => {
    const q = await quote(1)
    await db('sales_quote_documents').insert({ agencyId: CLOUD_AGENCY, quoteId: q.quoteId, status: 'rendering', path: `tenants/${CLOUD_AGENCY}/quotes/${q.quoteId}/dead.pdf`, createdAt: new Date(Date.now() - QUOTE_RENDER_STALE_MS - 1000) })
    await sweepQuotePdfs({ deps: { notice } })
    expect((await docsOf(q.quoteId)).map((d) => d.failureReason ?? d.status)).toEqual(['stale_render', 'ready'])
  }, 200_000)
})
