import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { currentQuoteDocument, hasLiveQuoteRender } from '@/db/quotes/documents'
import { findLiveQuoteDelivery } from '@/db/quotes/deliveries'
import { recordQuoteEvent } from '@/db/quotes/events'
import { isCustomerOptedOut } from '@/db/whatsappOptOuts'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { quotePdfFilename } from '@/lib/quotes/pdf/format'
import { contentDisposition } from '@/lib/storage/disposition'
import { presignDownload } from '@/lib/storage/objects'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'
import { businessDateString } from '@/lib/today/time'
import { isAdmin, type Roles } from '@/types/roles'
import type { ReplyButton, ReplyDocument } from '@/lib/whatsapp/platform/sendText'
import type { AgentScope } from '@/lib/agent/types'
import { resolveQuoteChannel } from './customerSend'
import { DELIVERY_COPY, quoteSendButtons, quoteSendCard } from './deliveryCopy'
import { startQuotePdf } from './pdfJob'

/**
 * The owner's private PDF preview, for the quote's CURRENT version and PDF.
 *
 * This is where the approval is bound: the `send_quote` action records the exact
 * version, document, content hash, customer number and business number, and the
 * single-use token on the buttons names that action's argsHash. A new card for
 * the same version is a new action, so the old token can never be replayed
 * against it. Nothing is sent to the customer here. The owner receives the PDF
 * even when the customer cannot be reached right now (no number, opted out, the
 * service window closed with no approved template): then without the send button.
 */

export const QUOTE_SEND_APPROVAL_TTL_HOURS = 2
/** Long enough for Meta to fetch it when the message goes out; the link goes to Meta, not into the text. */
const PREVIEW_LINK_SECONDS = 15 * 60

/**
 * `card`: the PDF itself, always. `sendable` says whether "לאשר ולשלוח ללקוח" is on
 * it: only when the customer can be reached now. Otherwise the card says why, and
 * keeps "לערוך" / "לבטל הצעה" when a recipient exists (none when there is nobody to send to).
 */
export type QuoteSendCard =
  | { kind: 'card'; sendable: boolean; stopReason: string; body: string; buttons: ReplyButton[]; document: ReplyDocument }
  | { kind: 'pending_pdf' | 'blocked'; text: string; stopReason: string }

export async function prepareQuoteSendCard(input: { agencyId: number; quoteId: number; scope: AgentScope; recipientId: number; jobId: number; nowMs: number }): Promise<QuoteSendCard> {
  const { agencyId, quoteId, scope, nowMs } = input
  const blocked = async (stopReason: string, text: string, version = 1): Promise<QuoteSendCard> => {
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion: version, type: 'preview_blocked', actorUserId: scope.userId, detail: { reason: stopReason } }).catch(() => undefined)
    return { kind: 'blocked', stopReason, text }
  }

  const quote = (await db('sales_quotes').where({ id: quoteId, agencyId }).first('leadId', 'status', 'version', 'quoteNumber', 'totalAmount', 'recipientNameSnapshot', db.raw(`"expiresAt"::text as "expiresOn"`))) as
    | { leadId: number; status: string; version: number; quoteNumber: number | string | null; totalAmount: number | string; recipientNameSnapshot: string | null; expiresOn: string | null }
    | undefined
  if (!quote) return { kind: 'blocked', stopReason: 'quote_preview_not_found', text: DELIVERY_COPY.noQuote }
  const version = Number(quote.version)
  // The PDF is customer data: nobody who cannot see this lead right now receives it.
  const visible = db('clients').where({ id: quote.leadId, agencyId })
  if (!isAdmin(scope.role as Roles)) visible.whereIn('userId', scope.gotPermIds ?? [])
  if (!(await visible.first('id'))) return blocked('quote_preview_lead_not_allowed', DELIVERY_COPY.notAllowed, version)

  const live = await findLiveQuoteDelivery(agencyId, quoteId)
  if (live) return blocked('quote_preview_delivery_live', live.state === 'unknown' || live.state === 'sending' ? DELIVERY_COPY.sendUnknown : DELIVERY_COPY.alreadySent, version)
  if (quote.status === 'ready' && quote.expiresOn && quote.expiresOn < businessDateString(nowMs)) return blocked('quote_preview_expired', DELIVERY_COPY.quoteExpired, version)
  if (quote.status !== 'ready') return blocked('quote_preview_not_ready', quote.status === 'sent' ? DELIVERY_COPY.alreadySent : DELIVERY_COPY.noQuote, version)

  const doc = await currentQuoteDocument(agencyId, quoteId)
  if (!doc || doc.quoteVersion !== version) {
    const started = await startQuotePdf({ agencyId, quoteId, renderedByUserId: scope.userId, nowMs })
    if (started === 'skipped' || started === 'error') {
      if (await hasLiveQuoteRender(agencyId, quoteId)) return { kind: 'pending_pdf', stopReason: 'quote_preview_pdf_pending', text: DELIVERY_COPY.pdfPending }
      return blocked('quote_preview_pdf_unavailable', DELIVERY_COPY.pdfUnavailable, version)
    }
    // The promise above: this render's result must reach the owner even if an earlier one already claimed the notice.
    await db.raw(`UPDATE sales_quotes SET metadata = metadata - 'pdfNotice' WHERE id = ? AND "agencyId" = ?`, [quoteId, agencyId])
    return { kind: 'pending_pdf', stopReason: 'quote_preview_pdf_pending', text: DELIVERY_COPY.pdfPending }
  }

  const leadId = Number(quote.leadId)
  // The PDF itself goes to the owner whatever happens next: a preview is the document, not a summary.
  let link: string
  const filename = quotePdfFilename(quote)
  try {
    link = await presignDownload({ key: doc.path, contentType: 'application/pdf', contentDisposition: contentDisposition(filename), expiresInSeconds: PREVIEW_LINK_SECONDS })
  } catch {
    return blocked('quote_preview_pdf_unavailable', DELIVERY_COPY.pdfUnavailable, version)
  }
  const document = { link, filename }
  const leadRow = (await db('clients').where({ id: leadId, agencyId }).first('firstName', 'lastName')) as { firstName: string | null; lastName: string | null } | undefined
  const card = (to: { recipient: string | null; phoneE164: string | null; blockedBy: string | null }) =>
    quoteSendCard({
      lead: [leadRow?.firstName, leadRow?.lastName].filter(Boolean).join(' '),
      quoteNumber: quote.quoteNumber == null ? null : Number(quote.quoteNumber),
      version,
      totalAmount: Number(quote.totalAmount),
      ttlHours: QUOTE_SEND_APPROVAL_TTL_HOURS,
      ...to,
    })
  // No one to send it to: the owner still sees the PDF, and why it cannot go out from here.
  const previewOnly = async (stopReason: string, why: string): Promise<QuoteSendCard> => {
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion: version, type: 'preview_offered', actorUserId: scope.userId, detail: { documentId: doc.id, sendable: false, reason: stopReason } })
    return { kind: 'card', sendable: false, stopReason, body: card({ recipient: null, phoneE164: null, blockedBy: why }), buttons: [], document }
  }

  const resolved = await resolveWhatsappOutboundTarget(agencyId, leadId)
  if (resolved.ok === false) return previewOnly(`quote_preview_${resolved.reason.replace(/-/g, '_')}`, resolved.reason === 'no-connection' ? DELIVERY_COPY.noConnection : DELIVERY_COPY.noCustomerNumber)
  const { target } = resolved
  const customerPhoneE164 = toCustomerPhoneE164(target.customerWaId)
  if (!customerPhoneE164) return previewOnly('quote_preview_no_recipient', DELIVERY_COPY.noCustomerNumber)
  // Reachable later (an opt-in, or the customer writing back), so the card can still be edited or cancelled now.
  const holdBack = (await isCustomerOptedOut(agencyId, customerPhoneE164))
    ? { stopReason: 'quote_preview_opted_out', why: DELIVERY_COPY.optedOut }
    : !(await resolveQuoteChannel({ agencyId, leadId, target, nowMs }))
      ? { stopReason: 'quote_preview_no_channel', why: DELIVERY_COPY.windowClosed }
      : null

  const outcome = await submitProposedAction({
    proposal: {
      actionType: 'send_quote',
      args: { quoteId, version, documentId: doc.id, contentHash: doc.contentHash, leadId, customerPhoneE164, businessPhoneNumberId: target.businessPhoneNumberId },
      evidenceRefs: [`lead:${leadId}`],
    },
    scope,
    agentRunId: `quote_send:${randomUUID()}`,
    nowMs,
  })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') return blocked('quote_preview_not_permitted', DELIVERY_COPY.noSendPermission, version)

  const { token } = await createWaApproval({ recipientId: input.recipientId, agencyId, userId: scope.userId, jobId: input.jobId, actionId: outcome.actionId, argsHash: outcome.argsHash, now: new Date(nowMs), ttlMs: QUOTE_SEND_APPROVAL_TTL_HOURS * 3600_000 })
  await recordQuoteEvent({ agencyId, quoteId, quoteVersion: version, type: 'preview_offered', actorUserId: scope.userId, actionId: outcome.actionId, detail: { documentId: doc.id, sendable: !holdBack, ...(holdBack ? { reason: holdBack.stopReason } : {}) } })

  return {
    kind: 'card',
    sendable: !holdBack,
    stopReason: holdBack?.stopReason ?? 'quote_preview_offered',
    body: card({ recipient: target.customerName ?? quote.recipientNameSnapshot ?? '', phoneE164: customerPhoneE164, blockedBy: holdBack?.why ?? null }),
    // Without a way to reach the customer now there is no send button at all; the executor would refuse it anyway.
    buttons: quoteSendButtons(token, { sendable: !holdBack }),
    document,
  }
}
