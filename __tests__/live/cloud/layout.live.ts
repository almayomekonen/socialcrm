import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { renderQuoteHtml, type QuotePdfQuote } from '@/lib/quotes/pdf/QuoteTemplate'
import type { QuotePdfItem } from '@/lib/quotes/pdf/components/QuoteLinesTable'

/**
 * The quote PDF's layout, measured in real local Chrome output by reading where
 * each word landed. A template string cannot show that two headers touch or that
 * totals sit alone on a page.
 */

const sh = promisify(execFile)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
type Word = { text: string; xMin: number; xMax: number; yMin: number; yMax: number }
type Page = { width: number; height: number; words: Word[] }

const QUOTE: QuotePdfQuote = { quoteNumber: 412, readyAt: '2026-11-08T10:00:00Z', expiresAt: '2026-12-08', title: 'שיפוץ מטבח', subtotalAmount: '1000.00', discountAmount: '0.00', taxAmount: '180.00', totalAmount: '1180.00', recipientNameSnapshot: 'דוד כהן', recipientPhoneSnapshot: '0501234567', recipientEmailSnapshot: '' }
const LONG = 'התקנת ארון מטבח עליון ותחתון בגימור לכה מט כולל מסילות טריקה שקטה וידיות נירוסטה דגם K-450 במידות 240×60 ס"מ לפי תוכנית'.slice(0, 120)
const item = (i: number, over: Partial<QuotePdfItem> = {}): QuotePdfItem => ({ id: i, title: `פריט מספר ${i}`, description: '', quantity: 1, unitPrice: '1000.0000', discount: '0.00', lineSubtotal: '1000.00', taxRatePercentSnapshot: 18, ...over })
const items = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1))

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
/** `-bbox` reports words as drawn, so a Hebrew word arrives reversed. */
const logical = (s: string) => (/[\u0590-\u05FF]/.test(s) ? [...s].reverse().join('') : s)

async function pagesOf(list: readonly QuotePdfItem[], over: Partial<QuotePdfQuote> = {}): Promise<Page[]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quote-layout-'))
  try {
    writeFileSync(path.join(dir, 'in.html'), await renderQuoteHtml({ quote: { ...QUOTE, ...over }, items: list, issuer: null, fallbackName: 'עסק בדיקה' }))
    await sh(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(dir, 'p')}`, `--print-to-pdf=${path.join(dir, 'o.pdf')}`, `file://${path.join(dir, 'in.html')}`], { timeout: 120_000 })
    const { stdout } = await sh('pdftotext', ['-bbox', path.join(dir, 'o.pdf'), '-'], { maxBuffer: 32 * 1024 * 1024 })
    return [...stdout.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)].map((p) => ({
      width: Number(p[1]),
      height: Number(p[2]),
      words: [...p[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((w) => ({ xMin: Number(w[1]), yMin: Number(w[2]), xMax: Number(w[3]), yMax: Number(w[4]), text: logical(decode(w[5])) })),
    }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const has = (p: Page, text: string) => p.words.some((w) => w.text === text)
const word = (p: Page, text: string) => {
  const w = p.words.find((x) => x.text === text)
  if (!w) throw new Error(`"${text}" is not a separate word: ${p.words.slice(0, 40).map((x) => x.text).join(' ')}`)
  return w
}
/** Two words whose ink shares space. A hair of tolerance for touching glyph boxes on adjacent lines. */
function overlaps(p: Page): string[] {
  const out: string[] = []
  p.words.forEach((a, i) => p.words.slice(i + 1).forEach((b) => {
    if (Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin) > 1 && Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin) > 3) out.push(`${a.text} / ${b.text}`)
  }))
  return out
}
const expectInsidePage = (p: Page) => {
  for (const w of p.words) {
    expect(w.xMin, w.text).toBeGreaterThanOrEqual(40)
    expect(w.xMax, w.text).toBeLessThanOrEqual(p.width - 40)
  }
}
const MIN_HEADER_GAP_PT = 8

describe('long item names', () => {
  it('the price and line-total headers stay apart', async () => {
    const [p] = await pagesOf([item(1, { title: LONG }), item(2, { title: LONG }), item(3, { title: LONG })])
    expect(word(p, 'ליחידה').xMin - word(p, 'סה"כ').xMax).toBeGreaterThanOrEqual(MIN_HEADER_GAP_PT)
    expect(overlaps(p)).toEqual([])
    expectInsidePage(p)
  })

  it('with a discount column as well', async () => {
    const [p] = await pagesOf([item(1, { title: LONG, discount: '100.00', lineSubtotal: '900.00' }), item(2, { title: LONG })])
    expect(word(p, 'ליחידה').xMin - word(p, 'הנחה').xMax).toBeGreaterThanOrEqual(MIN_HEADER_GAP_PT)
    expect(word(p, 'הנחה').xMin - word(p, 'סה"כ').xMax).toBeGreaterThanOrEqual(MIN_HEADER_GAP_PT)
    expect(overlaps(p)).toEqual([])
    expectInsidePage(p)
  })

  it('the largest amounts the columns can hold still fit, beside a long name and a word with no spaces', async () => {
    const big = { quantity: 999999, unitPrice: '99999999.9999', discount: '9999999.00', lineSubtotal: '99999999.00' }
    const pages = await pagesOf([item(1, { title: LONG, ...big }), item(2, { title: `מק"ט-${'ABCDEFGHIJ'.repeat(11)}`, ...big })], { subtotalAmount: '99999999.00', taxAmount: '17999999.82', totalAmount: '117999998.82' })
    for (const p of pages) {
      expect(overlaps(p)).toEqual([])
      expectInsidePage(p)
    }
    expect(word(pages[0], 'ליחידה').xMin - word(pages[0], 'הנחה').xMax).toBeGreaterThanOrEqual(MIN_HEADER_GAP_PT)
  })

  it('mixed Hebrew, Latin, digits and ₪ stay whole, in the right cells', async () => {
    const [p] = await pagesOf([item(1, { title: 'דלת 80×210 דגם X-200 (2 יחידות)', unitPrice: '1694.9167', lineSubtotal: '1694.92' })])
    for (const t of ['דלת', 'דגם', 'X-200']) expect(has(p, t), t).toBe(true)
    for (const digits of ['80', '210']) expect(p.words.some((w) => w.text.includes(digits)), digits).toBe(true)
    expect(word(p, '₪1,694.9167').xMax).toBeLessThan(word(p, 'דלת').xMin)
    expect(overlaps(p)).toEqual([])
  })
})

describe('pagination', () => {
  it('12 lines: the totals keep the closing rows, the repeated header and the quote number', async () => {
    const pages = await pagesOf(items(12))
    expect(pages.length).toBeGreaterThan(1)
    const last = pages.at(-1) as Page
    expect(has(last, 'לתשלום')).toBe(true)
    expect(has(last, '12')).toBe(true)
    expect(has(last, 'תיאור')).toBe(true)
    expect(has(last, 'הצעת') && has(last, '412')).toBe(true)
  })

  it.each([1, 2, 3, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 30, 50])('%i lines: totals are never without rows, later pages are named, and no page is left mostly blank', async (n) => {
    const pages = await pagesOf(items(n))
    const withTotals = pages.filter((p) => has(p, 'לתשלום'))
    expect(withTotals).toHaveLength(1)
    expect(withTotals[0]).toBe(pages.at(-1))
    expect(has(withTotals[0], String(n)) && has(withTotals[0], 'פריט')).toBe(true)
    pages.slice(1).forEach((p) => {
      expect(has(p, 'הצעת') && has(p, '412'), `page without the quote number at ${n} lines`).toBe(true)
      expect(has(p, 'תיאור'), `page without the column header at ${n} lines`).toBe(true)
    })
    if (pages.length > 1) {
      // What moves is two rows and the totals, so the page before stays at least half full.
      const before = pages.at(-2) as Page
      expect(Math.max(...before.words.map((w) => w.yMax))).toBeGreaterThan(before.height * 0.5)
    }
    for (const p of pages) {
      expect(overlaps(p)).toEqual([])
      expectInsidePage(p)
    }
  }, 60_000)

  it('the first page is not given the continuation line', async () => {
    const [first] = await pagesOf(items(12))
    expect(first.words.filter((w) => w.text === 'הצעת')).toHaveLength(1)
  })
})
