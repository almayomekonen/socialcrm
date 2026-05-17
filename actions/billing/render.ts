'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { canDraftBilling } from '@/lib/billing/permissions'
import { rerenderInvoicePdf } from '@/lib/billing/pdf/schedule'

/**
 * Explicit regeneration of an invoice's PDF. The legal invoice row is
 * unaffected — a new bill_documents row is appended; the prior current
 * row is demoted to non-current when the new render lands.
 *
 * Permission model: anyone who can DRAFT billing can also re-render an
 * existing issued invoice's PDF (it's not a state-changing operation on
 * the legal artifact). This matches the existing posture where regenerating
 * a file is a low-risk operation.
 */

export type RerenderResult = { success: true } | { error: true; reason: RerenderError }

export type RerenderError = 'no_permission' | 'lead_not_found' | 'invoice_not_found' | 'invoice_is_draft' | 'failed'

export async function rerenderInvoicePdfAction(input: {
  invoiceId: number
  leadId: number
}): Promise<RerenderResult> {
  const user = await requireUser()
  if (!canDraftBilling(user)) return { error: true, reason: 'no_permission' }

  const { gotPermIds } = await getPerms(user)
  const leadQ = db('clients').where({ id: input.leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  const invoice = await db('bill_invoices')
    .where({ id: input.invoiceId, agencyId: user.agencyId, leadId: input.leadId })
    .first('id', 'docState')
  if (!invoice) return { error: true, reason: 'invoice_not_found' }
  if (invoice.docState === 'draft') return { error: true, reason: 'invoice_is_draft' }

  try {
    await rerenderInvoicePdf({
      invoiceId: input.invoiceId,
      agencyId: user.agencyId,
      renderedByUserId: user.id,
    })
    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
    console.error('billing.action.rerender', JSON.stringify({ invoiceId: input.invoiceId, message: truncated }))
    return { error: true, reason: 'failed' }
  }
}
