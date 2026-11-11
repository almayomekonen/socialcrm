import 'server-only'
import { db } from '@/config/db'
import { isWaAssistantQuotesAgency, isWaAssistantQuotesSendAgency } from '@/lib/flags/waAssistantFlags'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendPlatformText } from '@/lib/whatsapp/platform/sendText'
import { resolveAssistantScope } from '../identity'
import { APP_ORIGIN } from '../render'
import { quotePdfFailedNotice, quotePdfReadyNotice } from './copy'
import { prepareQuoteSendCard } from './preview'
import { DELIVERY_COPY } from './deliveryCopy'

/**
 * The one follow-up about a quote's PDF, to the OWNER who approved it.
 *
 * WHO: the verified recipient on the approved card, re-checked through
 * `resolveAssistantScope` (active, consent, product access), on the platform
 * number. The address comes only from `owner_whatsapp_recipients`; no lead phone
 * is ever read here, so this path cannot reach a customer.
 *
 * AT MOST ONCE, per quote. `sales_quotes.metadata.pdfNotice` is claimed in one
 * guarded UPDATE before the send, the same rule as the assistant's replies: an
 * `unknown` outcome is never resent. No new column.
 */

export type QuotePdfNotice = { kind: 'ready'; handle: string } | { kind: 'failed' }
export type QuotePdfNoticeDeps = { send?: typeof sendPlatformText }
export type QuotePdfNoticeResult = 'sent' | 'unknown' | 'rejected' | 'not_eligible' | 'already_claimed'

/** Opaque in the link: the handle is the PDF's SHA-256, and the route still requires a session. */
export const quoteDownloadLink = (handle: string) => `${APP_ORIGIN}/api/quotes/${handle}/download`

async function claimNotice(agencyId: number, quoteId: number, kind: QuotePdfNotice['kind']): Promise<boolean> {
  const r = await db.raw(
    `UPDATE sales_quotes SET metadata = jsonb_set(metadata, '{pdfNotice}', :v::jsonb), "updatedAt" = now()
     WHERE id = :quoteId AND "agencyId" = :agencyId AND metadata->'pdfNotice' IS NULL RETURNING id`,
    { quoteId, agencyId, v: JSON.stringify({ kind, state: 'sending' }) },
  )
  return r.rows.length === 1
}

async function recordNotice(agencyId: number, quoteId: number, kind: QuotePdfNotice['kind'], state: string): Promise<void> {
  await db.raw(`UPDATE sales_quotes SET metadata = jsonb_set(metadata, '{pdfNotice}', :v::jsonb) WHERE id = :quoteId AND "agencyId" = :agencyId`, {
    quoteId,
    agencyId,
    v: JSON.stringify({ kind, state }),
  })
}

export async function notifyOwnerOfQuotePdf(input: { agencyId: number; quoteId: number; notice: QuotePdfNotice; now?: Date; deps?: QuotePdfNoticeDeps }): Promise<QuotePdfNoticeResult> {
  const { agencyId, quoteId, notice } = input
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  if (!phoneNumberId || !accessToken || !isWaAssistantQuotesAgency(agencyId)) return 'not_eligible'

  const quote = (await db('sales_quotes').where({ id: quoteId, agencyId }).first('quoteNumber', 'totalAmount', 'metadata')) as
    | { quoteNumber: number | string | null; totalAmount: number | string; metadata: { source?: string; actionId?: string } | null }
    | undefined
  const actionId = quote?.metadata?.actionId
  if (!quote || quote.metadata?.source !== 'wa_assistant' || !actionId) return 'not_eligible'
  if (!(await claimNotice(agencyId, quoteId, notice.kind))) return 'already_claimed'

  const approval = (await db('wa_assistant_approvals').where({ agencyId, actionId, status: 'approved' }).first('recipientId', 'userId', 'jobId')) as
    | { recipientId: number; userId: number; jobId: number }
    | undefined
  const who = approval ? await resolveAssistantScope({ recipientId: Number(approval.recipientId), agencyId, userId: Number(approval.userId) }, input.now ?? new Date()) : null
  if (!approval || !who || who.ok === false) {
    await recordNotice(agencyId, quoteId, notice.kind, 'not_eligible')
    return 'not_eligible'
  }

  const quoteNumber = quote.quoteNumber == null ? null : Number(quote.quoteNumber)
  // Quotes V2: the PDF itself as the owner's private preview, with the buttons that decide what happens to it.
  if (notice.kind === 'ready' && isWaAssistantQuotesSendAgency(agencyId)) {
    const card = await prepareQuoteSendCard({ agencyId, quoteId, scope: who.scope, recipientId: Number(approval.recipientId), jobId: Number(approval.jobId), nowMs: (input.now ?? new Date()).getTime() })
    if (card.kind === 'card') {
      const send = input.deps?.send ?? sendPlatformText
      let sent = await send({ phoneNumberId, accessToken, toE164: who.phoneE164, body: card.body, buttons: card.buttons, document: card.document, jobId: Number(approval.jobId) })
      // Meta refused the PDF message itself (not "unknown": that may have arrived): the owner still gets the file, by its login link.
      if (sent.kind === 'rejected') {
        sent = await send({ phoneNumberId, accessToken, toE164: who.phoneE164, body: `${quotePdfReadyNotice({ quoteNumber, totalAmount: Number(quote.totalAmount), link: quoteDownloadLink(notice.handle) })}\n\n${DELIVERY_COPY.previewFileFailed}`, jobId: Number(approval.jobId) })
      }
      const state = sent.kind === 'sent' ? 'sent' : sent.kind === 'unknown' ? 'unknown' : 'rejected'
      await recordNotice(agencyId, quoteId, notice.kind, state)
      return state
    }
    if (card.kind === 'pending_pdf') {
      await recordNotice(agencyId, quoteId, notice.kind, 'not_eligible')
      return 'not_eligible'
    }
    const told = await (input.deps?.send ?? sendPlatformText)({ phoneNumberId, accessToken, toE164: who.phoneE164, body: `${quotePdfReadyNotice({ quoteNumber, totalAmount: Number(quote.totalAmount), link: quoteDownloadLink(notice.handle) })}\n\n${card.text}`, jobId: Number(approval.jobId) })
    const state = told.kind === 'sent' ? 'sent' : told.kind === 'unknown' ? 'unknown' : 'rejected'
    await recordNotice(agencyId, quoteId, notice.kind, state)
    return state
  }

  const body =
    notice.kind === 'ready'
      ? quotePdfReadyNotice({ quoteNumber, totalAmount: Number(quote.totalAmount), link: quoteDownloadLink(notice.handle) })
      : quotePdfFailedNotice({ quoteNumber })
  const outcome = await (input.deps?.send ?? sendPlatformText)({ phoneNumberId, accessToken, toE164: who.phoneE164, body, jobId: Number(approval.jobId) })
  const state = outcome.kind === 'sent' ? 'sent' : outcome.kind === 'unknown' ? 'unknown' : 'rejected'
  await recordNotice(agencyId, quoteId, notice.kind, state)
  return state
}
