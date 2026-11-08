import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { db } from '@/config/db'
import { getObjectBytes, headObject } from '@/lib/storage/objects'
import { CLOUD_AGENCY, CLOUD_EXEMPT_AGENCY } from './env'
import { docsOf, quote, readDocument, start } from './harness'

const LONG = 'התקנת ארון מטבח עליון ותחתון בגימור לכה מט כולל מסילות טריקה שקטה וידיות נירוסטה דגם K-450 במידות 240×60 ס"מ לפי תוכנית'.slice(0, 120)

export function documentCases(): void {
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
    const pdf = await readDocument(q.quoteId, `lines-${lines}`, `${lines} lines: table, totals and page breaks`)
    expect(pdf.pages).toBeGreaterThanOrEqual(minPages)
    expect(pdf.text).toContain('כהן')
    // Every later page says which document it belongs to, whichever renderer drew it.
    for (const page of pdf.pageTexts.slice(1)) expect(page).toContain(`הצעת מחיר מספר ${q.quoteNumber}`)
    if (pdf.pages > 1) expect(pdf.pageTexts.at(-1)).toContain('פריט בדיקה')
  }, 200_000)

  it('a discount and a validity survive to the document', async () => {
    const q = await quote(2, { discountPercent: 10 })
    await start(q.quoteId)
    expect(q.totalAmount).toBe(2124)
    const { text } = await readDocument(q.quoteId, 'discount-validity', 'Discount row, totals after discount, valid-until date')
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
    const { text } = await readDocument(q.quoteId, 'vat-inclusive', 'Before-VAT price, 18% VAT and the total the owner stated')
    for (const figure of ['15,677.97', '2,822.03', '18,500.00']) expect(text).toContain(figure)
  }, 200_000)

  it('an exempt business shows 0% VAT, says it is exempt, and is stored under its own tenant', async () => {
    const q = await quote(1, { unitAmount: 18500, priceBasis: null, exempt: true })
    expect(await start(q.quoteId, {}, CLOUD_EXEMPT_AGENCY)).toBe('started')
    const [d] = await docsOf(q.quoteId)
    expect(d.path.startsWith(`tenants/${CLOUD_EXEMPT_AGENCY}/quotes/`)).toBe(true)
    const { text } = await readDocument(q.quoteId, 'exempt', 'Exempt business: "עוסק פטור", 0% VAT (wording pending the accountant)')
    expect(text).toContain('פטור')
    expect(text).toContain('0%')
    expect(text).toContain('18,500.00')
    expect(text).not.toContain('2,822.03')
  }, 200_000)

  it('mixed Hebrew, digits and Latin: the fonts are embedded and the text survives', async () => {
    const q = await quote(1, { unitAmount: 1694.92, lineTitles: ['דלת 80×210 דגם X-200 (2 יחידות)'] })
    await start(q.quoteId)
    const { text } = await readDocument(q.quoteId, 'mixed-hebrew-digits-latin', 'Hebrew, numbers, × and a Latin model name on one line; order must read correctly')
    for (const part of ['דלת', 'יחידות', 'X-200', '1,694.92']) expect(text).toContain(part)
  }, 200_000)

  it('long item names wrap without losing the row', async () => {
    const q = await quote(3, { lineTitles: [LONG, LONG, LONG] })
    await start(q.quoteId)
    const { text } = await readDocument(q.quoteId, 'long-item-names', 'Three 120-character names: wrapping, row height, no overlap with prices')
    expect(text).toContain('K-450')
    expect(text).toContain('3,540.00')
  }, 200_000)

  it('a free quote renders as a zero-value document', async () => {
    const q = await quote(1, { unitAmount: 0, lineTitles: ['ייעוץ ראשוני בחינם'] })
    await start(q.quoteId)
    expect(q.totalAmount).toBe(0)
    const { text } = await readDocument(q.quoteId, 'free-zero', 'A free quote: ₪0.00 line and total')
    expect(text).toContain('0.00')
  }, 200_000)
}
