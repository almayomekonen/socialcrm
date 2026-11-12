import 'server-only'
import { db } from '@/config/db'
import { isSmartbeeAgency } from '@/lib/flags/smartbeeFlags'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendPlatformText } from '@/lib/whatsapp/platform/sendText'
import { claimSmartbeeNotice, findSmartbeeDocument, recordSmartbeeNotice } from '@/db/smartbee/documents'
import { resolveAssistantScope } from '../identity'
import { documentCreatedNotice, documentNotIssuedNotice } from './copy'
import { deliverSmartbeeDocumentToCustomer, type CustomerDelivery, type CustomerDeliveryDeps } from './customerDelivery'

/**
 * The one message about a SmartBee document's outcome, to the OWNER who
 * approved it, on the platform number. Same rules as the quote PDF notice
 * (../quotes/pdfNotice.ts):
 *
 *   WHO: the verified recipient on the approved card, re-checked through
 *   `resolveAssistantScope`, and it must still be the user who approved. The
 *   address comes only from `owner_whatsapp_recipients`. The customer's copy is
 *   a separate send to the LEAD's own contact (./customerDelivery.ts), never to
 *   this number, and the owner is told its outcome in this same message.
 *
 *   WHEN: only for a terminal row. "Issued" only from a stored 102 (number and
 *   links from SmartBee); a draft, failure or stall says so plainly.
 *
 *   AT MOST ONCE: `noticeState` is claimed in one guarded UPDATE before the
 *   send, and an `unknown` send is never repeated.
 */

export type SmartbeeNoticeDeps = { send?: typeof sendPlatformText; customer?: CustomerDeliveryDeps }
export type SmartbeeNoticeResult = 'sent' | 'unknown' | 'rejected' | 'not_eligible' | 'already_claimed' | 'not_terminal'

export async function notifyOwnerOfSmartbeeDocument(input: {
  agencyId: number
  documentId: number
  now?: Date
  deps?: SmartbeeNoticeDeps
}): Promise<SmartbeeNoticeResult> {
  const { agencyId, documentId } = input
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  if (!phoneNumberId || !accessToken || !isSmartbeeAgency(agencyId)) return 'not_eligible'

  const row = await findSmartbeeDocument(agencyId, documentId)
  if (!row) return 'not_eligible'
  if (row.status === 'pending' || row.status === 'queued') return 'not_terminal'
  if (!(await claimSmartbeeNotice(agencyId, documentId))) return 'already_claimed'

  const approval = (await db('wa_assistant_approvals')
    .where({ agencyId, actionId: row.agentActionId, status: 'approved' })
    .first('recipientId', 'userId', 'jobId')) as { recipientId: number; userId: number; jobId: number } | undefined
  const who =
    approval && Number(approval.userId) === row.approvedByUserId
      ? await resolveAssistantScope(
          { recipientId: Number(approval.recipientId), agencyId, userId: Number(approval.userId) },
          input.now ?? new Date(),
        )
      : null
  if (!approval || !who || who.ok === false) {
    await recordSmartbeeNotice(agencyId, documentId, 'not_eligible')
    return 'not_eligible'
  }

  const created = row.status === 'created' && row.docIndex ? row.docIndex : null
  // The customer's copy, only for a confirmed document with SmartBee's link, and only
  // here: after this row's once-only claim, so it is never sent twice. Never throws.
  const customer =
    created && row.linkToOriginal
      ? await deliverSmartbeeDocumentToCustomer({
          agencyId,
          documentId,
          leadId: row.leadId,
          docType: row.docType,
          number: created,
          link: row.linkToOriginal,
          approvedByUserId: row.approvedByUserId,
          nowMs: (input.now ?? new Date()).getTime(),
          deps: input.deps?.customer,
        }).catch((): CustomerDelivery => 'failed')
      : null
  const body = created
    ? documentCreatedNotice({
        docType: row.docType,
        number: created,
        amount: row.totalAmount,
        allocationNumber: row.taxConfirmationNumber,
        link: row.linkToOriginal,
        customer,
      })
    : documentNotIssuedNotice({
        docType: row.docType,
        status: row.status === 'created' ? 'stalled' : row.status,
        reason: row.failureReason,
      })
  const outcome = await (input.deps?.send ?? sendPlatformText)({
    phoneNumberId,
    accessToken,
    toE164: who.phoneE164,
    body,
    jobId: Number(approval.jobId),
  })
  const state = outcome.kind === 'sent' ? 'sent' : outcome.kind === 'unknown' ? 'unknown' : 'rejected'
  await recordSmartbeeNotice(agencyId, documentId, state)
  return state
}
