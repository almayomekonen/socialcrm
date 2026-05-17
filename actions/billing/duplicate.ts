'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { canDraftBilling } from '@/lib/billing/permissions'
import { createDraftInvoice, getInvoiceLinesByInvoiceId } from '@/db/billing/invoices'
import { addInvoiceLine } from '@/db/billing/invoiceLines'

export type DuplicateInvoiceResult = { success: true; invoiceId: number } | { error: true; reason: DuplicateInvoiceErrorReason }

export type DuplicateInvoiceErrorReason = 'no_permission' | 'lead_not_found' | 'invoice_not_found' | 'failed'

export async function duplicateInvoiceAction(input: { invoiceId: number; leadId: number }): Promise<DuplicateInvoiceResult> {
  const user = await requireUser()
  if (!canDraftBilling(user)) return { error: true, reason: 'no_permission' }

  const { gotPermIds } = await getPerms(user)
  const leadQ = db('clients').where({ id: input.leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  const source = await db('bill_invoices')
    .where({ id: input.invoiceId, agencyId: user.agencyId, leadId: input.leadId })
    .first('id', 'leadId', 'billingProfileId', 'currency', 'locale', 'internalNotes', 'customerFooter')
  if (!source) return { error: true, reason: 'invoice_not_found' }

  const lines = await getInvoiceLinesByInvoiceId(input.invoiceId)

  try {
    const draft = await createDraftInvoice({
      leadId: Number(source.leadId),
      billingProfileId: Number(source.billingProfileId),
      currency: String(source.currency ?? 'ILS'),
      locale: String(source.locale ?? 'he'),
      internalNotes: String(source.internalNotes ?? ''),
      customerFooter: String(source.customerFooter ?? ''),
      dueAt: null,
    })

    for (const line of lines) {
      await addInvoiceLine({
        invoiceId: draft.id,
        title: line.title,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRateId: line.taxRateId,
      })
    }

    revalidatePath(`/clients/${input.leadId}/billing`)
    return { success: true, invoiceId: draft.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
    console.error(
      'billing.action.duplicate',
      JSON.stringify({ sourceInvoiceId: input.invoiceId, leadId: input.leadId, message: truncated }),
    )
    return { error: true, reason: 'failed' }
  }
}
