import 'server-only'
import { db } from '@/config/db'
import { QUOTE_RENDER_MAX_ATTEMPTS, closeStaleQuoteRenders, currentQuoteDocumentHandle, failedQuoteRenderCount, hasLiveQuoteRender } from '@/db/quotes/documents'
import { isWaAssistantQuotesAgency, waAssistantQuotesAgencyIds, waAssistantQuotesForAll } from '@/lib/flags/waAssistantFlags'
import { startQuotePdf, type QuotePdfJobDeps } from './pdfJob'
import { notifyOwnerOfQuotePdf } from './pdfNotice'

/**
 * The recovery pass for quote PDFs, from the assistant's minute cron. It finds
 * WhatsApp quotes whose owner has not heard about the PDF yet, and finishes
 * whichever step was lost: the notice, a retry, or the final "it failed".
 *
 * Inert with no agency on WA_ASSISTANT_QUOTES_AGENCY_IDS and no `all` audience
 * (no query at all). With `all`, each row is still checked against the switch.
 * Bounded: quotes from the last hour, and at most ONE render a tick, because a
 * render can take most of the function's 60 seconds.
 */

const SWEEP_WINDOW_MS = 60 * 60 * 1000
const SWEEP_BATCH = 10

export async function sweepQuotePdfs(opts: { nowMs?: number; deps?: QuotePdfJobDeps } = {}): Promise<{ rendered: number; notified: number }> {
  const summary = { rendered: 0, notified: 0 }
  const forAll = waAssistantQuotesForAll()
  const agencies = waAssistantQuotesAgencyIds()
  if (!forAll && !agencies.length) return summary
  const nowMs = opts.nowMs ?? Date.now()

  const query = db('sales_quotes')
  if (!forAll) query.whereIn('agencyId', agencies)
  const rows = (await query
    .where('status', 'ready')
    .where((q) => q.where('readyAt', '>', new Date(nowMs - SWEEP_WINDOW_MS)).orWhere((e) => e.where('version', '>', 1).where('updatedAt', '>', new Date(nowMs - SWEEP_WINDOW_MS))))
    .whereRaw(`metadata->>'source' = 'wa_assistant'`)
    .whereRaw(`metadata->'pdfNotice' IS NULL`)
    .orderBy('readyAt', 'asc')
    .limit(SWEEP_BATCH)
    .select('id', 'agencyId')) as { id: number | string; agencyId: number }[]
  const due = rows.filter((r) => isWaAssistantQuotesAgency(Number(r.agencyId)))

  for (const row of due) {
    const quoteId = Number(row.id)
    const agencyId = Number(row.agencyId)
    const handle = await currentQuoteDocumentHandle(agencyId, quoteId)
    if (handle) {
      await notifyOwnerOfQuotePdf({ agencyId, quoteId, notice: { kind: 'ready', handle }, deps: opts.deps?.notice })
      summary.notified++
      continue
    }
    await closeStaleQuoteRenders(agencyId, quoteId, nowMs)
    if (await hasLiveQuoteRender(agencyId, quoteId)) continue
    if ((await failedQuoteRenderCount(agencyId, quoteId)) >= QUOTE_RENDER_MAX_ATTEMPTS) {
      await notifyOwnerOfQuotePdf({ agencyId, quoteId, notice: { kind: 'failed' }, deps: opts.deps?.notice })
      summary.notified++
      continue
    }
    if (summary.rendered === 0) {
      await startQuotePdf({ agencyId, quoteId, renderedByUserId: null, inline: true, nowMs, deps: opts.deps })
      summary.rendered++
    }
  }
  return summary
}
