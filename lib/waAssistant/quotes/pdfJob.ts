import 'server-only'
import { after } from 'next/server'
import { QUOTE_RENDER_MAX_ATTEMPTS, claimQuoteRender, closeStaleQuoteRenders, currentQuoteDocumentHandle, failedQuoteRenderCount, markQuoteDocumentFailed } from '@/db/quotes/documents'
import { quotePdfKey } from '@/lib/storage/keys'
import type { QuoteRenderDeps } from '@/lib/quotes/pdf/renderAndStore'
import { notifyOwnerOfQuotePdf, type QuotePdfNoticeDeps } from './pdfNotice'

/**
 * Starts a quote's PDF without making the WhatsApp reply wait.
 *
 * NEVER THROWS into the approval: the quote already exists and stays exactly as
 * approved whatever happens here. IDEMPOTENT: the claim is one guarded insert,
 * so a quote with a current PDF or a running render is left alone.
 *
 * `after()` runs once the reply has gone, inside the same 60-second function; a
 * tap's job is short, so the render's own timeout (at most 55 s) fits. If the
 * function dies anyway, the row goes stale and ./pdfSweep.ts retries it.
 *
 * The owner hears once: when it is ready, or when it can no longer succeed.
 * A retryable failure says nothing yet; the sweep tries again within a minute.
 */

export type QuotePdfJobDeps = { render?: QuoteRenderDeps; notice?: QuotePdfNoticeDeps }
export type QuotePdfStart = 'started' | 'skipped' | 'error'

/** Waiting a minute does not fix these. */
const PERMANENT = new Set(['quote_not_found', 'quote_not_renderable', 'storage_config_missing', 'pdf_config_missing', 'pdf_auth', 'font_missing'])

async function runJob(input: { documentId: number; quoteId: number; agencyId: number; objectPath: string; deps?: QuotePdfJobDeps }): Promise<void> {
  const { documentId, quoteId, agencyId, objectPath } = input
  try {
    // Lazy: the font and renderer load only when a PDF is made, so a problem there cannot break the worker at import.
    const { renderAndStoreQuotePdf } = await import('@/lib/quotes/pdf/renderAndStore')
    const outcome = await renderAndStoreQuotePdf({ documentId, quoteId, agencyId, objectPath, deps: input.deps?.render })
    if (outcome.status === 'ready') {
      await notifyOwnerOfQuotePdf({ agencyId, quoteId, notice: { kind: 'ready', handle: outcome.contentHash }, deps: input.deps?.notice })
    } else if (outcome.status === 'failed') {
      if (PERMANENT.has(outcome.reason) || (await failedQuoteRenderCount(agencyId, quoteId)) >= QUOTE_RENDER_MAX_ATTEMPTS) {
        await notifyOwnerOfQuotePdf({ agencyId, quoteId, notice: { kind: 'failed' }, deps: input.deps?.notice })
      }
    }
  } catch (err) {
    console.error('[quotes.pdf] job.fatal', JSON.stringify({ quoteId, name: (err as Error)?.name ?? null }))
    await markQuoteDocumentFailed(documentId, agencyId, 'render_error').catch(() => undefined)
  }
}

export async function startQuotePdf(input: {
  agencyId: number
  quoteId: number
  renderedByUserId: number | null
  /** The sweep already runs in the background and awaits the render. */
  inline?: boolean
  nowMs?: number
  deps?: QuotePdfJobDeps
}): Promise<QuotePdfStart> {
  const { agencyId, quoteId } = input
  try {
    if (await currentQuoteDocumentHandle(agencyId, quoteId)) return 'skipped'
    await closeStaleQuoteRenders(agencyId, quoteId, input.nowMs ?? Date.now())
    if ((await failedQuoteRenderCount(agencyId, quoteId)) >= QUOTE_RENDER_MAX_ATTEMPTS) return 'skipped'

    const objectPath = quotePdfKey(agencyId, quoteId)
    const documentId = await claimQuoteRender({ agencyId, quoteId, path: objectPath, renderedByUserId: input.renderedByUserId })
    if (documentId == null) return 'skipped'

    const job = () => runJob({ documentId, quoteId, agencyId, objectPath, deps: input.deps })
    if (input.inline) {
      await job()
      return 'started'
    }
    try {
      after(job)
    } catch {
      // Outside a request scope (a script or a test).
      void Promise.resolve().then(job)
    }
    return 'started'
  } catch (err) {
    console.error('[quotes.pdf] start.fail', JSON.stringify({ quoteId, name: (err as Error)?.name ?? null }))
    return 'error'
  }
}
