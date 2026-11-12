import 'server-only'
import { db } from '@/config/db'
import { getAgencyName, getAgencyReplyTo } from '@/db/automations/leadFacts'
import { getAutomationsFrom } from '@/lib/automations/flags'
import { resolveSenderIdentity } from '@/lib/automations/identity'
import { renderAutomationEmail } from '@/lib/automations/renderEmail'
import { leadUnsubscribeUrl } from '@/lib/automations/unsubscribeToken'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import { sendWhatsappText, type SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'
import { AUTOMATED_SEND_TIMEOUT_MS } from '@/lib/whatsapp/sendOutcome'
import type { SmartbeeDocType } from '@/lib/integrations/providers/smartbee/types'
import { baseUrl } from '@/types/vars'
import { leadInviteEmail } from '../quotes/emailInvite'
import { DOC_TYPE_LABEL } from './copy'

/**
 * The PDF link of a document SmartBee CONFIRMED (a stored 102), to the CUSTOMER:
 * the lead's own WhatsApp conversation while its 24-hour window is open,
 * otherwise the lead's email address. SmartBee itself still never emails the
 * customer (`sendOriginalToCustomer: false`); this is the one channel that does.
 *
 * Called only from the owner notice (./notice.ts), after its once-only claim on
 * the row, so it runs at most once per document and never re-submits anything
 * to SmartBee. Every read is scoped by agency. The recipient is the lead's
 * WhatsApp contact or email, never the owner's number. An ambiguous WhatsApp
 * send is NOT followed by an email (the customer may already have it).
 */

export type CustomerDelivery = 'whatsapp' | 'email' | 'whatsapp_unknown' | 'no_channel' | 'failed'

export type CustomerDeliveryDeps = {
  sendText?: typeof sendWhatsappText
  sendEmail?: (args: { from: string; replyTo: string; to: string; subject: string; html: string; text: string; headers: Record<string, string>; idempotencyKey: string }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
}

/** Meta's 24 hours, with the same one-hour margin the quote delivery keeps. */
const WINDOW_MARGIN_MS = 60 * 60 * 1000

export const customerDocumentMessage = (input: { name: string; docType: SmartbeeDocType; number: string; business: string; link: string }) =>
  [`שלום${input.name ? ` ${input.name}` : ''},`, `מצורפת ${DOC_TYPE_LABEL[input.docType]} מספר ${input.number}${input.business ? ` מ${input.business}` : ''}:`, input.link].join('\n')

export async function deliverSmartbeeDocumentToCustomer(input: {
  agencyId: number
  documentId: number
  leadId: number
  docType: SmartbeeDocType
  number: string
  link: string
  approvedByUserId: number | null
  nowMs: number
  deps?: CustomerDeliveryDeps
}): Promise<CustomerDelivery> {
  const { agencyId, leadId, nowMs } = input
  const lead = (await db('clients').where({ id: leadId, agencyId }).first('firstName', 'lastName')) as { firstName: string | null; lastName: string | null } | undefined
  if (!lead) return 'no_channel'
  const name = [lead.firstName, lead.lastName].filter((s) => s && s.trim()).join(' ').trim()
  const business = (await getAgencyName(agencyId))?.trim() ?? ''
  const body = customerDocumentMessage({ name, docType: input.docType, number: input.number, business, link: input.link })

  const resolved = await resolveWhatsappOutboundTarget(agencyId, leadId)
  if (resolved.ok === true) {
    const { target } = resolved
    const conv = (await db('inbox_conversations')
      .where({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: target.businessPhoneNumberId, customerWaId: target.customerWaId })
      .first('lastInboundAt')) as { lastInboundAt: Date | string | null } | undefined
    if (resolveWhatsappServiceWindow(conv?.lastInboundAt ?? null, nowMs + WINDOW_MARGIN_MS) === 'OPEN') {
      // 'automated' is the consent the opt-out gate refuses outright.
      const sent = await (input.deps?.sendText ?? sendWhatsappText)({
        phoneNumberId: target.businessPhoneNumberId,
        accessToken: target.accessToken,
        to: target.customerWaId,
        consent: { kind: 'automated', agencyId },
        timeoutMs: AUTOMATED_SEND_TIMEOUT_MS,
        body,
      }).catch((): SendWhatsappTextResult => ({ ok: false, error: 'exception', ambiguous: true }))
      if (sent.ok === true) {
        await persistOutboundWhatsapp({
          agencyId,
          leadId,
          businessPhoneNumberId: target.businessPhoneNumberId,
          customerWaId: target.customerWaId,
          customerName: target.customerName,
          sentByUserId: input.approvedByUserId,
          wamid: sent.wamid,
          text: body,
          metadata: { source: 'smartbee_document' },
          skipAnalysis: true,
        }).catch((err) => console.error('[smartbee.deliver] inbox.persist.fail', (err as Error)?.name))
        return 'whatsapp'
      }
      if ('ambiguous' in sent && sent.ambiguous) return 'whatsapp_unknown'
      // A definite refusal (opt-out, Graph error): nothing reached the customer, so email may still go.
    }
  }

  const email = await leadInviteEmail(agencyId, leadId)
  if (!email) return 'no_channel'
  const identity = resolveSenderIdentity({ agencyName: business || null, replyTo: await getAgencyReplyTo(agencyId) }, getAutomationsFrom()).identity
  if (!identity) return 'no_channel'
  const unsubscribe = leadUnsubscribeUrl(baseUrl, agencyId, leadId)
  const label = DOC_TYPE_LABEL[input.docType]
  const rendered = await renderAutomationEmail({
    subject: `${label} מספר ${input.number}`,
    body: [name ? `שלום ${name},` : 'שלום,', `מצורפת ${label} מספר ${input.number}.`, 'לחצו על הכפתור כדי לפתוח את הקובץ.'].join('\n\n'),
    vars: { businessName: identity.displayName } as never,
    unsubscribeUrl: unsubscribe,
    action: { label: `פתיחת ה${label}`, url: input.link },
  })
  const send =
    input.deps?.sendEmail ??
    (async (a: Parameters<NonNullable<CustomerDeliveryDeps['sendEmail']>>[0]) => {
      const { sendEmail } = await import('@/lib/email/sender')
      return sendEmail(a)
    })
  const sent = await send({
    from: identity.from,
    replyTo: identity.replyTo,
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    // One document, one email, even if this request is repeated.
    idempotencyKey: `smartbee-document/${agencyId}/${input.documentId}`,
  }).catch(() => null)
  return sent?.ok === true ? 'email' : 'failed'
}
