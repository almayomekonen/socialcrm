import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { MAX_BUTTON_BODY_CHARS } from '@/lib/whatsapp/platform/sendText'
import { resolveIntegrationAccess } from '@/lib/integrations/core/permissions'
import { dealerNumberOf, validateDocumentDraft, type ConfirmedPayment } from '@/lib/integrations/providers/smartbee/payload'
import { db } from '@/config/db'
import { unsettledSmartbeeDocument } from '@/db/smartbee/documents'
import type { SmartbeeVatOption } from '@/lib/integrations/providers/smartbee/types'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { requestMessages } from '../request'
import { chooseLead } from '../leadChoice'
import { isStated, statedAmounts, statedBasis } from '../quotes/grounding'
import { descriptionGrounded, statedCheckNumber, statedDocType, statedInstallments, statedPaymentMethod, statedTransferReference } from './grounding'
import { DOCUMENT_COPY, documentButtons, documentCard } from './copy'

/**
 * "תפיק חשבונית מס קבלה ליוסי כהן על צילום חתונה, 1,500 שקל כולל מע"מ, שולם
 * במזומן" → a confirmation card, or ONE question about what is missing.
 *
 * NOTHING IS ISSUED HERE, and SmartBee is not called. In order:
 *   1. access (lib/integrations/core/permissions.ts): allowlisted agency, active
 *      connection, and THIS user is the connection's owner;
 *   2. the lead, readable by this user (leadChoice.ts);
 *   3. type, amount, VAT basis and payment re-read from the owner's OWN words;
 *      the model's fields are only a hint and never reach the card unchecked;
 *   4. the customer's name and ID number read ONCE, shown on the card and frozen
 *      into the arguments; the business type's rules and SmartBee's field
 *      rules (payload.ts);
 *   5. the application's arguments (including the connection and its
 *      environment, so the card binds them) recorded AWAITING_APPROVAL, and a
 *      single-use, recipient-bound, 15-minute token on the buttons.
 *
 * A receipt needs the owner to state the method and amount; the card says, in
 * words, that approving confirms the payment was received. A customer's message
 * never reaches this path: it runs only on the owner's verified number.
 */

export type DocumentProposal = Extract<ProposedAction, { actionType: 'create_smartbee_document' }>
export type DocumentProposeDeps = { submit?: typeof submitProposedAction; access?: typeof resolveIntegrationAccess }

const clarify = (text: string, why: string, lead?: string): MeetingReply => ({
  status: 'answered',
  stopReason: `document_clarify_${why}`,
  text,
  headline: lead ? `${text} (מסמך SmartBee · ליד: ${lead})` : text,
})
const refuse = (stopReason: string, text: string): MeetingReply => ({ status: 'refused', stopReason, text, headline: null })

export async function proposeSmartbeeDocument(input: {
  job: WaAssistantJob
  scope: AgentScope
  proposal: DocumentProposal
  evidence: readonly EvidenceRef[]
  agentRunId: string
  question: string
  nowMs: number
  deps?: DocumentProposeDeps
}): Promise<MeetingReply> {
  const { job, scope, nowMs, proposal: p } = input
  const access = await (input.deps?.access ?? resolveIntegrationAccess)({ provider: 'smartbee', agencyId: scope.agencyId, userId: scope.userId })
  if (access.ok === false) return refuse(`document_${access.reason}`, access.reason === 'not_owner' ? DOCUMENT_COPY.notOwner : DOCUMENT_COPY.notConnected)
  const connection = access.connection
  const said = await requestMessages('document', job, input.question)

  const clientId = Number(p.args.clientId)
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return clarify(DOCUMENT_COPY.askLead, 'lead')
  const choice = await chooseLead({ scope, proposedId: clientId, evidence: input.evidence, said })
  if ('refused' in choice) return refuse('document_lead_not_allowed', DOCUMENT_COPY.leadNotAllowed)
  if ('ask' in choice) return clarify(choice.ask, 'lead')
  const lead = choice.lead
  const unsettled = await unsettledSmartbeeDocument(scope.agencyId, lead.id)
  if (unsettled === 'stalled') return refuse('document_unresolved', DOCUMENT_COPY.unresolved)
  if (unsettled) return refuse('document_in_flight', DOCUMENT_COPY.inFlight)

  const docType = statedDocType(said)
  if (!docType || docType === 'ambiguous') return clarify(DOCUMENT_COPY.askType, 'type', lead.name)
  if (connection.businessType === 'exempt' && docType !== 'Receipt') return refuse('document_type_not_allowed', DOCUMENT_COPY.typeNotAllowed)

  const amount = p.args.amount
  if (amount == null || !isStated(amount, statedAmounts(said))) return clarify(DOCUMENT_COPY.askAmount, 'amount', lead.name)
  const description = p.args.description?.trim() ?? ''
  if (!descriptionGrounded(description, said)) return clarify(DOCUMENT_COPY.askDescription, 'description', lead.name)

  let vatOption: SmartbeeVatOption | null = null
  if (docType !== 'Receipt') {
    const basis = statedBasis(said)
    if (basis !== 'incl_vat' && basis !== 'excl_vat') return clarify(DOCUMENT_COPY.askVat, 'vat', lead.name)
    if (docType === 'InvoiceReceipt' && basis !== 'incl_vat') return clarify(DOCUMENT_COPY.askInvoiceReceiptInclVat, 'vat', lead.name)
    vatOption = basis === 'incl_vat' ? 'Include' : 'NotInclude'
  }

  let payment: ConfirmedPayment | null = null
  if (docType !== 'Invoice') {
    const stated = statedPaymentMethod(said)
    if (stated === 'ambiguous') return clarify(DOCUMENT_COPY.askOnePayment, 'payment', lead.name)
    if (!stated) return clarify(DOCUMENT_COPY.askPayment, 'payment', lead.name)
    const checkNumber = stated.method === 'check' ? statedCheckNumber(said) : null
    if (stated.method === 'check' && !checkNumber) return clarify(DOCUMENT_COPY.askCheckNumber, 'check', lead.name)
    const installments = stated.method === 'credit_card' ? statedInstallments(said) : null
    if (installments != null && (installments < 1 || installments > 99)) return clarify(DOCUMENT_COPY.askInstallments, 'installments', lead.name)
    payment = {
      method: stated.method,
      amount,
      paidOn: null,
      installments,
      checkNumber,
      reference: stated.method === 'bank_transfer' ? statedTransferReference(said) : null,
      otherLabel: stated.otherLabel,
    }
  }

  // The customer exactly as the card shows it, frozen into the approved arguments: a lead edited after this
  // card does not change the document. Read inside the agency; chooseLead already proved this user may see it.
  const row = (await db('clients').where({ id: lead.id, agencyId: scope.agencyId }).first('firstName', 'lastName', 'idNum')) as
    | { firstName: string | null; lastName: string | null; idNum: string | null }
    | undefined
  if (!row) return refuse('document_lead_not_allowed', DOCUMENT_COPY.leadNotAllowed)
  const customerName = [row.firstName, row.lastName].map((s) => s?.trim()).filter(Boolean).join(' ')
  const customerIdNumber = dealerNumberOf(row.idNum)

  const draft = { docType, description, amount, vatOption, payment, customer: { name: customerName, idNum: customerIdNumber } }
  const valid = validateDocumentDraft(draft, connection.businessType)
  if (valid.ok === false) {
    if (valid.reason === 'customer_name_invalid') return refuse('document_lead_name_invalid', DOCUMENT_COPY.leadNameInvalid)
    if (valid.reason === 'description_invalid') return clarify(DOCUMENT_COPY.askDescription, 'description', lead.name)
    if (valid.reason === 'amount_invalid') return clarify(DOCUMENT_COPY.askAmount, 'amount', lead.name)
    return refuse(`document_invalid_${valid.reason}`, DOCUMENT_COPY.invalid)
  }

  const text = documentCard({ docType, lead: customerName, customerIdNumber, description, amount, vatOption, payment, sandbox: connection.environment === 'test' })
  if (text.length > MAX_BUTTON_BODY_CHARS) return refuse('document_card_too_long', DOCUMENT_COPY.tooLongForCard)

  const evidenceRefs = p.evidenceRefs.includes(`lead:${lead.id}`) ? p.evidenceRefs : [...p.evidenceRefs, `lead:${lead.id}`]
  const final = {
    actionType: 'create_smartbee_document' as const,
    args: {
      clientId: lead.id,
      docType,
      description,
      amount,
      vatOption,
      payment,
      customerName,
      customerIdNumber,
      connectionId: connection.id,
      environment: connection.environment,
    },
    evidenceRefs,
  }
  const outcome = await (input.deps?.submit ?? submitProposedAction)({ proposal: final as unknown as ProposedAction, scope, agentRunId: input.agentRunId })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') {
    return { status: 'failed', stopReason: `document_propose_${outcome?.report ?? 'unparsed'}`, text: DOCUMENT_COPY.notPrepared, headline: null }
  }
  const { token } = await createWaApproval({
    recipientId: job.recipientId,
    agencyId: scope.agencyId,
    userId: scope.userId,
    jobId: job.id,
    actionId: outcome.actionId,
    argsHash: outcome.argsHash,
    now: new Date(nowMs),
  })
  return {
    status: 'answered',
    stopReason: 'document_awaiting_approval',
    text,
    buttons: documentButtons(token),
    headline: 'ממתין לאישור הפקת מסמך ב-SmartBee',
  }
}
