'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { canIssueBilling } from '@/lib/billing/permissions'
import { issueInvoice } from '@/db/billing/issueInvoice'
import { getIssuer } from '@/db/billing/issuer'
import { checkIssuerCompleteness } from '@/lib/billing/issuer/completeness'
import { saveTransientDraftAction, type SaveTransientDraftInput, type DraftErrorReason } from './drafts'

export type IssueActionResult =
  | { success: true; documentNumber: number; documentYear: number; issuedAt: string; totalAmount: number }
  | { error: true; reason: IssueErrorReason }

export type IssueErrorReason =
  | 'no_permission'
  | 'lead_not_found'
  | 'invoice_not_found'
  | 'not_draft'
  | 'empty_lines'
  | 'profile_archived'
  | 'empty_legal_name'
  | 'zero_total'
  | 'issuer_identity_incomplete'
  | 'payment_incomplete'
  | 'payment_exceeds_total'
  | 'failed'

export async function issueInvoiceAction(input: { invoiceId: number; leadId: number }): Promise<IssueActionResult> {
  const user = await requireUser()
  if (!canIssueBilling(user)) return { error: true, reason: 'no_permission' }

  const { gotPermIds } = await getPerms(user)

  const leadQ = db('clients').where({ id: input.leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  const ownership = await db('bill_invoices').where({ id: input.invoiceId, agencyId: user.agencyId }).first('id', 'leadId')
  if (!ownership) return { error: true, reason: 'invoice_not_found' }
  if (Number(ownership.leadId) !== Number(input.leadId)) {
    return { error: true, reason: 'invoice_not_found' }
  }

  const issuer = await getIssuer(user.agencyId)
  if (!issuer || !checkIssuerCompleteness(issuer).complete) {
    return { error: true, reason: 'issuer_identity_incomplete' }
  }

  try {
    const result = await issueInvoice({ invoiceId: input.invoiceId })
    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    revalidatePath(`/clients/${input.leadId}/billing`)
    return {
      success: true,
      documentNumber: result.documentNumber,
      documentYear: result.documentYear,
      issuedAt: result.issuedAt,
      totalAmount: result.totalAmount,
    }
  } catch (err) {
    return mapEngineError(err, input.invoiceId)
  }
}

export type SaveAndIssueResult =
  | {
      success: true
      invoiceId: number
      documentNumber: number
      documentYear: number
      issuedAt: string
      totalAmount: number
    }
  | { error: true; reason: IssueErrorReason | DraftErrorReason; invoiceId?: number }

export async function saveAndIssueTransientAction(input: SaveTransientDraftInput): Promise<SaveAndIssueResult> {
  const user = await requireUser()
  const issuer = await getIssuer(user.agencyId)
  if (!issuer || !checkIssuerCompleteness(issuer).complete) {
    return { error: true, reason: 'issuer_identity_incomplete' }
  }

  const saveResult = await saveTransientDraftAction(input)
  if ('error' in saveResult) {
    return { error: true, reason: saveResult.reason }
  }

  const issueResult = await issueInvoiceAction({
    invoiceId: saveResult.invoiceId,
    leadId: input.leadId,
  })

  if ('error' in issueResult) {
    return { error: true, reason: issueResult.reason, invoiceId: saveResult.invoiceId }
  }

  return {
    success: true,
    invoiceId: saveResult.invoiceId,
    documentNumber: issueResult.documentNumber,
    documentYear: issueResult.documentYear,
    issuedAt: issueResult.issuedAt,
    totalAmount: issueResult.totalAmount,
  }
}

function mapEngineError(err: unknown, invoiceId: number): IssueActionResult {
  const message = err instanceof Error ? err.message : String(err)
  const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
  console.error('billing.action.issue', JSON.stringify({ invoiceId, message: truncated }))

  switch (message) {
    case 'billing.issue.invoice_not_found':
      return { error: true, reason: 'invoice_not_found' }
    case 'billing.issue.not_draft':
      return { error: true, reason: 'not_draft' }
    case 'billing.issue.profile_not_found':
      return { error: true, reason: 'failed' }
    case 'billing.validate.empty_lines':
      return { error: true, reason: 'empty_lines' }
    case 'billing.validate.profile_archived':
      return { error: true, reason: 'profile_archived' }
    case 'billing.validate.empty_legal_name':
      return { error: true, reason: 'empty_legal_name' }
    case 'billing.validate.zero_total':
    case 'billing.validate.invalid_subtotal':
    case 'billing.validate.invalid_tax':
    case 'billing.validate.invalid_total':
      return { error: true, reason: 'zero_total' }
    case 'billing.validate.payment_method_missing':
    case 'billing.validate.payment_method_invalid':
    case 'billing.validate.payment_amount_missing':
    case 'billing.validate.payment_amount_invalid':
    case 'billing.validate.payment_date_missing':
      return { error: true, reason: 'payment_incomplete' }
    case 'billing.validate.payment_amount_exceeds_total':
      return { error: true, reason: 'payment_exceeds_total' }
    default:
      return { error: true, reason: 'failed' }
  }
}
