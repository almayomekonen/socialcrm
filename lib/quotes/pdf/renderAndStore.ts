import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/config/db'
import { markQuoteDocumentFailed, markQuoteDocumentReady } from '@/db/quotes/documents'
import { getIssuerForRender } from '@/db/billing/issuer'
import { failureReason } from '@/lib/billing/pdf/renderAndStore'
import { renderPdfFromHtml } from '@/lib/pdf/renderer'
import { logStorageEvent } from '@/lib/storage/events'
import { putObject } from '@/lib/storage/objects'
import { renderQuoteHtml, type QuotePdfQuote } from './QuoteTemplate'
import type { QuotePdfItem } from './components/QuoteLinesTable'

/**
 * One document, from `rendering` to terminal: load → render → upload → mark
 * ready. EVERY exit closes the row with a named reason; it never touches the
 * quote itself, so a failed render leaves the quote exactly as approved. The
 * bytes go to the existing private R2 bucket under a server-chosen key.
 */

export type QuoteRenderDeps = { render?: typeof renderPdfFromHtml; put?: typeof putObject }
export type QuoteRenderOutcome =
  | { status: 'ready'; contentHash: string; byteSize: number }
  /** Closed as stale while this process ran: another attempt owns the quote now. */
  | { status: 'abandoned' }
  | { status: 'failed'; reason: string }

/** The quote exists but can never be rendered as it stands. */
const NOT_RENDERABLE = ['draft', 'cancelled']

export async function renderAndStoreQuotePdf(input: { documentId: number; quoteId: number; agencyId: number; objectPath: string; deps?: QuoteRenderDeps }): Promise<QuoteRenderOutcome> {
  const { documentId, quoteId, agencyId } = input
  const fail = async (reason: string): Promise<QuoteRenderOutcome> => {
    await markQuoteDocumentFailed(documentId, agencyId, reason)
    return { status: 'failed', reason }
  }
  try {
    const quote = (await db('sales_quotes').where({ id: quoteId, agencyId }).first()) as (QuotePdfQuote & { status: string }) | undefined
    if (!quote) return await fail('quote_not_found')
    if (NOT_RENDERABLE.includes(quote.status)) return await fail('quote_not_renderable')

    const [items, issuer, agency] = await Promise.all([
      db('sales_quote_items').where({ agencyId, quoteId }).orderBy('lineNumber', 'asc') as Promise<QuotePdfItem[]>,
      getIssuerForRender(agencyId),
      db('agencies').where({ id: agencyId }).first('name'),
    ])
    const html = await renderQuoteHtml({ quote, items, issuer, fallbackName: agency?.name ? String(agency.name) : '' })
    const bytes = await (input.deps?.render ?? renderPdfFromHtml)(html)

    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const startedAt = Date.now()
    try {
      await (input.deps?.put ?? putObject)({ key: input.objectPath, body: bytes, contentType: 'application/pdf', metadata: { sha256: contentHash } })
    } catch (err) {
      logStorageEvent('pdf.upload.failed', { agencyId, documentId, code: (err as Error).name })
      throw err
    }
    logStorageEvent('pdf.upload.completed', { agencyId, documentId, size: bytes.byteLength, latencyMs: Date.now() - startedAt })

    const saved = await markQuoteDocumentReady({ documentId, agencyId, quoteId, contentHash, byteSize: bytes.byteLength })
    return saved ? { status: 'ready', contentHash, byteSize: bytes.byteLength } : { status: 'abandoned' }
  } catch (err) {
    return fail(failureReason(err))
  }
}
