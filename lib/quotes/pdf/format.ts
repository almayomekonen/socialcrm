import { businessDateString } from '@/lib/today/time'
import { formatMoney } from '@/lib/billing/pdf/format'

/** Pure formatters for quote documents and the WhatsApp copy about them. */

export const ils = (n: number | string) => `₪${formatMoney(n)}`

/**
 * A before-VAT unit price keeps its stored precision (up to 4 places), so
 * "qty × price = line" adds up on the card and on the PDF.
 */
export function unitIls(n: number | string): string {
  const v = Number(n)
  if (!Number.isFinite(v) || Math.round(v * 100) / 100 === v) return ils(v)
  return `₪${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

/** DD/MM/YYYY of the BUSINESS day (architecture-rules §11), never the server's timezone. */
export function businessDate(at: string | Date): string {
  const ms = new Date(at).getTime()
  if (Number.isNaN(ms)) return ''
  const [y, m, d] = businessDateString(ms).split('-')
  return `${d}/${m}/${y}`
}

/** The filename the owner downloads. Customer text, so path characters are stripped. */
export function quotePdfFilename(quote: { quoteNumber: number | string | null; recipientNameSnapshot: string | null }): string {
  const num = quote.quoteNumber != null ? String(quote.quoteNumber).padStart(5, '0') : 'pending'
  const name = (quote.recipientNameSnapshot ?? '').trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || 'Customer'
  return `Quote-${num}-${name}.pdf`
}
