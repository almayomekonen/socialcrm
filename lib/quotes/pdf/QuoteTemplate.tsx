import type { IssuerData } from '@/lib/billing/issuer/fields'
import { COLOR, FONT_FAMILY, PAGE, SP } from '@/lib/billing/pdf/html/styles'
import { fontFaceBlock } from '@/lib/billing/pdf/html/fontEmbed'
import { formatPdfDate } from '@/lib/billing/pdf/format'
import { DocumentFooter } from '@/lib/billing/pdf/html/components/DocumentFooter'
import { QuoteHeader } from './components/QuoteHeader'
import { QuoteRecipient } from './components/QuoteRecipient'
import { QuoteLinesTable, type QuotePdfItem } from './components/QuoteLinesTable'
import { QuoteTotals } from './components/QuoteTotals'
import { businessDate } from './format'

/**
 * The quote document: HTML for `renderPdfFromHtml`. Reuses the invoice's design
 * tokens, embedded Hebrew font and footer; its header, table and totals are its
 * own, so nothing here can change an invoice PDF.
 *
 * Every figure is the quote row's stored value, and every text field is rendered
 * by React (escaped). `expiresAt` is shown only when the owner stated a validity.
 *
 * No logo: the invoice pipeline does not wire one either (`agencyLogoPng` is
 * never passed), and it waits on the deferred logo plumbing.
 *
 * react-dom/server is a DYNAMIC import for the same reason as InvoiceTemplate:
 * Next's RSC compiler rejects a static import reachable from a server action.
 */

export type QuotePdfQuote = {
  quoteNumber: number | string
  readyAt: string | Date
  expiresAt: string | Date | null
  title: string
  subtotalAmount: number | string
  discountAmount: number | string
  taxAmount: number | string
  totalAmount: number | string
  recipientNameSnapshot: string | null
  recipientPhoneSnapshot: string | null
  recipientEmailSnapshot: string | null
}

export type QuoteTemplateInput = {
  quote: QuotePdfQuote
  items: readonly QuotePdfItem[]
  issuer: IssuerData | null
  /** `agencies.name`, when the issuer profile has no name. */
  fallbackName: string
}

type RenderToStaticMarkup = (element: React.ReactElement) => string
let renderer: Promise<RenderToStaticMarkup> | null = null
const staticMarkup = () => (renderer ??= import('react-dom/server').then((m) => m.renderToStaticMarkup as RenderToStaticMarkup))

/** The rate when every line shares one, which the totals row can then state. */
function sharedRate(items: readonly QuotePdfItem[]): number | null {
  const rates = [...new Set(items.map((i) => Number(i.taxRatePercentSnapshot)))]
  return rates.length === 1 && Number.isFinite(rates[0]) ? rates[0] : null
}

export async function renderQuoteHtml(input: QuoteTemplateInput): Promise<string> {
  const { quote, items, issuer } = input
  const displayName = issuer?.name?.trim() || input.fallbackName.trim()
  const body = (await staticMarkup())(
    <main style={{ padding: `0 ${PAGE.margin}`, color: COLOR.text, fontFamily: FONT_FAMILY, fontSize: '11pt', lineHeight: 1.5 }}>
      <QuoteHeader issuer={issuer} displayName={displayName} quoteNumber={quote.quoteNumber} issuedDate={businessDate(quote.readyAt)} validUntil={quote.expiresAt ? formatPdfDate(quote.expiresAt as string) : ''} />
      <Gap />
      <hr style={{ border: 0, borderTop: `1px solid ${COLOR.ruleSoft}`, margin: 0 }} />
      <Gap />
      <QuoteRecipient name={quote.recipientNameSnapshot ?? ''} phone={quote.recipientPhoneSnapshot ?? ''} email={quote.recipientEmailSnapshot ?? ''} subject={quote.title} />
      <Gap />
      <QuoteLinesTable items={items} />
      <Gap />
      {/* One block, so the footer can never land alone on a page of its own. */}
      <div style={{ breakInside: 'avoid' }}>
        <QuoteTotals subtotal={quote.subtotalAmount} discount={quote.discountAmount} tax={quote.taxAmount} total={quote.totalAmount} ratePercent={sharedRate(items)} />
        <DocumentFooter customerFooter='' displayName={displayName} />
      </div>
    </main>,
  )
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>Quote</title>
<style>
${fontFaceBlock()}
@page { size: ${PAGE.width} ${PAGE.height}; margin: ${PAGE.margin} 0; }
html, body { margin: 0; padding: 0; background: white; }
body { font-family: ${FONT_FAMILY}; color: ${COLOR.text}; }
* { box-sizing: border-box; }
</style>
</head>
<body>${body}</body>
</html>`
}

function Gap() {
  return <div style={{ height: SP.xl, lineHeight: 0 }} />
}
