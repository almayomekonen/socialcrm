import 'server-only'
import { db } from '@/config/db'
import { claimQuoteDelivery, findQuoteDeliveryByAction, markQuoteDeliveryAccepted, markQuoteDeliveryFailed, markQuoteDeliveryUnknown, type ClaimResult, type QuoteDeliveryRow } from '@/db/quotes/deliveries'
import { getIssuerForRender } from '@/db/billing/issuer'
import { isWaAssistantQuotesSendAgency } from '@/lib/flags/waAssistantFlags'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { resolveWhatsappOutboundTarget, type WhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import { hashQuoteLinkToken, newQuoteLinkToken, quoteLinkExpiry, quoteLinkPath } from '@/lib/quotes/deliveryLink'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'
import { sendWhatsappText, type SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'
import { AUTOMATED_SEND_TIMEOUT_MS } from '@/lib/whatsapp/sendOutcome'
import { businessDateString } from '@/lib/today/time'
import { APP_ORIGIN } from '../render'
import { quoteCustomerMessage, quoteInboxSummary } from './deliveryCopy'
import { inviteByEmail, type InviteOutcome } from './emailInvite'

/**
 * The only path that puts a quote in front of a customer. Called only by the
 * `send_quote` executor, which runs only after the owner's tap.
 *
 * Everything the owner approved is compared with the world as it is NOW: the
 * version, the PDF, the customer's number and the business number. Then one
 * claim, then at most one provider request. The send primitives run the opt-out
 * gate themselves. `unknown` is never retried.
 */

/** `customerEmailHash`: the address the card offered an email invitation to, when WhatsApp could not reach the customer. */
export type QuoteSendArgs = { quoteId: number; version: number; documentId: number; contentHash: string; leadId: number; customerPhoneE164: string; businessPhoneNumberId: string; customerEmailHash?: string | null }

export const QUOTE_DELIVERY_TEMPLATE = 'quote_delivery_he'
/** Meta's 24 hours, with the same one-hour margin the assistant's own replies keep. */
const WINDOW_MARGIN_MS = 60 * 60 * 1000

type Template = { name: string; language: string }
export type QuoteChannel = { channel: 'text' } | { channel: 'template'; template: Template }

export type QuoteSendOutcome =
  | { kind: 'accepted'; deliveryId: number }
  | { kind: 'duplicate'; delivery: QuoteDeliveryRow }
  | { kind: 'stale'; reason: string }
  | { kind: 'disabled' | 'no_target' | 'no_channel' }
  | { kind: 'opted_out' | 'failed'; code: string }
  | { kind: 'unknown' }
  | Exclude<InviteOutcome, { kind: 'stale' }>

/** Free text inside the customer's service window; outside it, only an approved UTILITY template. Null when neither. */
export async function resolveQuoteChannel(input: { agencyId: number; leadId: number; target: WhatsappOutboundTarget; nowMs: number }): Promise<QuoteChannel | null> {
  const { agencyId, leadId, target, nowMs } = input
  const conv = (await db('inbox_conversations')
    .where({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: target.businessPhoneNumberId, customerWaId: target.customerWaId })
    .first('lastInboundAt')) as { lastInboundAt: Date | string | null } | undefined
  if (resolveWhatsappServiceWindow(conv?.lastInboundAt ?? null, nowMs + WINDOW_MARGIN_MS) === 'OPEN') return { channel: 'text' }

  const row = (await db('whatsapp_templates').where({ agencyId, name: QUOTE_DELIVERY_TEMPLATE, status: 'approved' }).whereNull('archivedAt').first('name', 'language', 'category', 'bodyText')) as
    | { name: string; language: string | null; category: string | null; bodyText: string | null }
    | undefined
  if (!row || row.category?.toUpperCase() !== 'UTILITY') return null
  // {{1}} name, {{2}} quote number, {{3}} business, {{4}} link: anything else would send a mismatched count.
  if (new Set(row.bodyText?.match(/\{\{\d+\}\}/g) ?? []).size !== 4) return null
  return { channel: 'template', template: { name: row.name, language: row.language ?? 'he' } }
}

const claimOutcome = (c: Exclude<ClaimResult, { kind: 'claimed' }>): QuoteSendOutcome => (c.kind === 'duplicate' ? { kind: 'duplicate', delivery: c.delivery } : { kind: 'stale', reason: c.reason })

/**
 * `invite`: only the owner's approval (the `send_quote` executor) may fall back to
 * an email invitation. The customer's WhatsApp reply to one runs this same path
 * without it, so a reply can only ever deliver on WhatsApp.
 */
export async function sendQuoteToCustomer(input: { agencyId: number; userId: number; actionId: string; args: QuoteSendArgs; nowMs: number; invite?: boolean }): Promise<QuoteSendOutcome> {
  const { agencyId, userId, actionId, args, nowMs } = input
  const own = await findQuoteDeliveryByAction(agencyId, actionId)
  if (own) return { kind: 'duplicate', delivery: own }
  if (!isWaAssistantQuotesSendAgency(agencyId)) return { kind: 'disabled' }

  const quote = (await db('sales_quotes').where({ id: args.quoteId, agencyId, leadId: args.leadId }).first('quoteNumber', 'recipientNameSnapshot', db.raw(`"expiresAt"::text as "expiresOn"`))) as
    | { quoteNumber: number | string | null; recipientNameSnapshot: string | null; expiresOn: string | null }
    | undefined
  if (!quote) return { kind: 'stale', reason: 'quote_not_found' }

  const resolved = await resolveWhatsappOutboundTarget(agencyId, args.leadId)
  if (resolved.ok === false) return { kind: 'no_target' }
  const { target } = resolved
  if (toCustomerPhoneE164(target.customerWaId) !== args.customerPhoneE164 || target.businessPhoneNumberId !== args.businessPhoneNumberId) return { kind: 'stale', reason: 'recipient_changed' }

  const chosen = await resolveQuoteChannel({ agencyId, leadId: args.leadId, target, nowMs })
  if (!chosen) {
    if (!input.invite || !args.customerEmailHash) return { kind: 'no_channel' }
    const invited = await inviteByEmail({ agencyId, userId, actionId, args: { ...args, customerEmailHash: args.customerEmailHash }, target, expiresOn: quote.expiresOn, nowMs })
    return invited.kind === 'stale' ? { kind: 'stale', reason: invited.reason } : invited
  }

  const token = newQuoteLinkToken()
  const claim = await claimQuoteDelivery({
    agencyId,
    quoteId: args.quoteId,
    quoteVersion: args.version,
    documentId: args.documentId,
    contentHash: args.contentHash,
    actionId,
    leadId: args.leadId,
    approvedByUserId: userId,
    customerPhoneE164: args.customerPhoneE164,
    businessPhoneNumberId: args.businessPhoneNumberId,
    channel: chosen.channel,
    linkTokenHash: hashQuoteLinkToken(token),
    linkExpiresAt: quoteLinkExpiry(quote.expiresOn, nowMs),
    businessDate: businessDateString(nowMs),
  })
  if (claim.kind !== 'claimed') return claimOutcome(claim)

  const marks = { deliveryId: claim.deliveryId, agencyId, quoteId: args.quoteId, quoteVersion: args.version, userId, actionId }
  const quoteNumber = quote.quoteNumber == null ? null : Number(quote.quoteNumber)
  const link = `${APP_ORIGIN}${quoteLinkPath(token)}`
  const sent = await deliver({ agencyId, target, chosen, quoteNumber, customerName: quote.recipientNameSnapshot ?? '', link }).catch((): SendWhatsappTextResult => ({ ok: false, error: 'exception', ambiguous: true }))

  if (sent.ok === true) {
    await markQuoteDeliveryAccepted({ ...marks, wamid: sent.wamid })
    await persistOutboundWhatsapp({
      agencyId,
      leadId: args.leadId,
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
      sentByUserId: userId,
      wamid: sent.wamid,
      text: quoteInboxSummary(quoteNumber),
      metadata: { source: 'quote_delivery' },
      skipAnalysis: true,
    }).catch((err) => console.error('[quotes.send] inbox.persist.fail', (err as Error)?.name))
    return { kind: 'accepted', deliveryId: claim.deliveryId }
  }
  if ('ambiguous' in sent && sent.ambiguous) {
    await markQuoteDeliveryUnknown(marks)
    return { kind: 'unknown' }
  }
  const code = sent.optOutBlocked ? 'opted_out' : (sent.code ?? 'rejected')
  await markQuoteDeliveryFailed({ ...marks, code })
  return sent.optOutBlocked ? { kind: 'opted_out', code } : { kind: 'failed', code }
}

async function deliver(input: { agencyId: number; target: WhatsappOutboundTarget; chosen: QuoteChannel; quoteNumber: number | null; customerName: string; link: string }): Promise<SendWhatsappTextResult> {
  const { agencyId, target, chosen, quoteNumber, customerName, link } = input
  const issuer = await getIssuerForRender(agencyId)
  const agency = issuer?.name?.trim() ? null : await db('agencies').where({ id: agencyId }).first('name')
  const business = issuer?.name?.trim() || String(agency?.name ?? '')
  // 'automated' is the consent the gate refuses outright for an opted-out customer.
  const base = { phoneNumberId: target.businessPhoneNumberId, accessToken: target.accessToken, to: target.customerWaId, consent: { kind: 'automated' as const, agencyId } }
  if (chosen.channel === 'text') return sendWhatsappText({ ...base, timeoutMs: AUTOMATED_SEND_TIMEOUT_MS, body: quoteCustomerMessage({ name: customerName, quoteNumber, business, link }) })
  return sendWhatsappTemplate({
    ...base,
    name: chosen.template.name,
    language: chosen.template.language,
    params: [customerName.trim() || 'לקוח יקר', quoteNumber != null ? String(quoteNumber) : '-', business.trim() || 'העסק', link],
  })
}
