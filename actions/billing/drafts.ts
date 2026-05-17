'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { canDraftBilling } from '@/lib/billing/permissions'
import { getOrCreateBillingProfileForLead } from '@/db/billing/profiles'
import {
  createDraftInvoice,
  updateDraftMeta,
  updateDraftKindAndPayment,
  deleteDraftInvoice,
  type BillInvoiceRow,
  type DocumentKind,
} from '@/db/billing/invoices'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import {
  addInvoiceLine,
  updateInvoiceLine,
  removeInvoiceLine,
  type AddLineInput,
  type UpdateLineInput,
} from '@/db/billing/invoiceLines'

export type DraftActionResult<T = unknown> = ({ success: true } & T) | { error: true; reason: DraftErrorReason }

export type DraftErrorReason =
  | 'no_permission'
  | 'lead_not_found'
  | 'invoice_not_found'
  | 'invoice_not_draft'
  | 'line_not_found'
  | 'invalid_input'
  | 'empty_lines'
  | 'failed'

export async function createDraftFromLeadAction({
  leadId,
}: {
  leadId: number
}): Promise<DraftActionResult<{ invoiceId: number }>> {
  const user = await requireUser()
  if (!canDraftBilling(user)) return { error: true, reason: 'no_permission' }

  const { gotPermIds } = await getPerms(user)

  const leadQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id', 'name')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  try {
    const profile = await getOrCreateBillingProfileForLead({
      leadId,
      legalName: String(lead.name ?? '').trim() || 'ללא שם',
    })
    const invoice = await createDraftInvoice({
      leadId,
      billingProfileId: profile.id,
    })
    revalidatePath(`/clients/${leadId}/billing`)
    return { success: true, invoiceId: invoice.id }
  } catch (err) {
    logActionError('billing.action.create_draft', err, { leadId })
    return { error: true, reason: 'failed' }
  }
}

export async function updateDraftMetaAction(input: {
  invoiceId: number
  leadId: number
  dueAt?: string | null
  internalNotes?: string
  customerFooter?: string
}): Promise<DraftActionResult> {
  const guard = await guardLeadInvoice(input.leadId, input.invoiceId)
  if ('error' in guard) return guard

  try {
    await updateDraftMeta({
      invoiceId: input.invoiceId,
      dueAt: input.dueAt,
      internalNotes: input.internalNotes,
      customerFooter: input.customerFooter,
    })
    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    revalidatePath(`/clients/${input.leadId}/billing`)
    return { success: true }
  } catch (err) {
    logActionError('billing.action.update_meta', err, { invoiceId: input.invoiceId })
    return { error: true, reason: 'failed' }
  }
}

export async function updateDraftKindAndPaymentAction(input: {
  invoiceId: number
  leadId: number
  kind: DocumentKind
  paymentMethod: PaymentMethod | null
  paymentAmount: number | null
  paymentDate: string | null
}): Promise<DraftActionResult> {
  const guard = await guardLeadInvoice(input.leadId, input.invoiceId)
  if ('error' in guard) return guard

  try {
    await updateDraftKindAndPayment({
      invoiceId: input.invoiceId,
      kind: input.kind,
      paymentMethod: input.paymentMethod,
      paymentAmount: input.paymentAmount,
      paymentDate: input.paymentDate,
    })
    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    return { success: true }
  } catch (err) {
    logActionError('billing.action.update_payment', err, { invoiceId: input.invoiceId })
    return { error: true, reason: 'failed' }
  }
}

export async function deleteDraftAction(input: { invoiceId: number; leadId: number }): Promise<DraftActionResult> {
  const guard = await guardLeadInvoice(input.leadId, input.invoiceId)
  if ('error' in guard) return guard

  try {
    await deleteDraftInvoice(input.invoiceId)
    revalidatePath(`/clients/${input.leadId}/billing`)
    return { success: true }
  } catch (err) {
    logActionError('billing.action.delete_draft', err, { invoiceId: input.invoiceId })
    return { error: true, reason: 'failed' }
  }
}

export async function addLineAction(input: {
  leadId: number
  line: AddLineInput
}): Promise<DraftActionResult<{ lineId: number }>> {
  const guard = await guardLeadInvoice(input.leadId, input.line.invoiceId)
  if ('error' in guard) return guard

  const validation = validateLineInputs({
    title: input.line.title,
    quantity: input.line.quantity,
    unitPrice: input.line.unitPrice,
    discount: input.line.discount,
  })
  if (!validation.ok) return { error: true, reason: 'invalid_input' }

  try {
    const lineId = await addInvoiceLine(input.line)
    revalidatePath(`/clients/${input.leadId}/billing/${input.line.invoiceId}`)
    return { success: true, lineId }
  } catch (err) {
    logActionError('billing.action.add_line', err, { invoiceId: input.line.invoiceId })
    return { error: true, reason: 'failed' }
  }
}

export async function updateLineAction(input: {
  leadId: number
  invoiceId: number
  line: UpdateLineInput
}): Promise<DraftActionResult> {
  const guard = await guardLeadInvoice(input.leadId, input.invoiceId)
  if ('error' in guard) return guard

  const validation = validateLineInputs({
    title: input.line.title,
    quantity: input.line.quantity,
    unitPrice: input.line.unitPrice,
    discount: input.line.discount,
  })
  if (!validation.ok) return { error: true, reason: 'invalid_input' }

  try {
    await updateInvoiceLine(input.line)
    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    return { success: true }
  } catch (err) {
    logActionError('billing.action.update_line', err, { lineId: input.line.lineId })
    return { error: true, reason: 'failed' }
  }
}

function validateLineInputs(input: {
  title?: string
  quantity?: number
  unitPrice?: number
  discount?: number
}): { ok: true } | { ok: false } {
  if (input.title !== undefined && !input.title?.trim()) return { ok: false }
  if (input.quantity !== undefined) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { ok: false }
  }
  if (input.unitPrice !== undefined) {
    if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) return { ok: false }
  }
  if (input.discount !== undefined) {
    if (!Number.isFinite(input.discount) || input.discount < 0) return { ok: false }
  }
  return { ok: true }
}

export async function removeLineAction(input: { leadId: number; invoiceId: number; lineId: number }): Promise<DraftActionResult> {
  const guard = await guardLeadInvoice(input.leadId, input.invoiceId)
  if ('error' in guard) return guard

  try {
    await removeInvoiceLine(input.lineId)
    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    return { success: true }
  } catch (err) {
    logActionError('billing.action.remove_line', err, { lineId: input.lineId })
    return { error: true, reason: 'failed' }
  }
}

export type TransientLineInput = {
  title: string
  description?: string
  quantity: number
  unitPrice: number
  discount?: number
}

export type SaveTransientDraftInput = {
  leadId: number
  meta?: {
    dueAt?: string | null
    internalNotes?: string
    customerFooter?: string
  }
  lines: TransientLineInput[]
  kind?: DocumentKind
  payment?: {
    method: PaymentMethod | null
    amount: number | null
    date: string | null
  }
}

export async function saveTransientDraftAction(
  input: SaveTransientDraftInput,
): Promise<DraftActionResult<{ invoiceId: number }>> {
  const user = await requireUser()
  if (!canDraftBilling(user)) return { error: true, reason: 'no_permission' }

  const { gotPermIds } = await getPerms(user)

  const leadQ = db('clients').where({ id: input.leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id', 'name')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  if (!Array.isArray(input.lines)) return { error: true, reason: 'invalid_input' }
  if (input.lines.length === 0) return { error: true, reason: 'empty_lines' }
  for (const line of input.lines) {
    const v = validateLineInputs({
      title: line?.title,
      quantity: line?.quantity,
      unitPrice: line?.unitPrice,
      discount: line?.discount,
    })
    if (!v.ok) return { error: true, reason: 'invalid_input' }
  }

  try {
    // Billing profile resolution is idempotent (the partial unique
    // index on bill_billing_profiles accepts ON CONFLICT DO NOTHING)
    // and is safe to run outside the transaction. Keeping it outside
    // avoids contention on that index when retried.
    const profile = await getOrCreateBillingProfileForLead({
      leadId: input.leadId,
      legalName: String(lead.name ?? '').trim() || 'ללא שם',
    })

    // Draft row + every line insert run in ONE transaction. If any
    // line insert throws (validation, DB constraint, network), the
    // transaction rolls back: no orphan draft, no partial lines. This
    // is the all-or-nothing guarantee for the /billing/new flow.
    const invoiceId = await db.transaction(async (trx) => {
      const invoice = await createDraftInvoice(
        {
          leadId: input.leadId,
          billingProfileId: profile.id,
          dueAt: input.meta?.dueAt ?? null,
          customerFooter: input.meta?.customerFooter ?? '',
          internalNotes: input.meta?.internalNotes ?? '',
        },
        trx,
      )

      for (const line of input.lines) {
        await addInvoiceLine(
          {
            invoiceId: invoice.id,
            title: line.title,
            description: line.description ?? '',
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount ?? 0,
          },
          trx,
        )
      }

      // Combined-document branch: stamp kind + payment fields onto the
      // fresh draft so a subsequent issuance reads consistent state.
      // Plain-invoice drafts skip this entirely and behave as before.
      if (input.kind === 'invoice_receipt') {
        await trx('bill_invoices')
          .where({ id: invoice.id, agencyId: user.agencyId, docState: 'draft' })
          .update({
            kind: 'invoice_receipt',
            paymentMethod: input.payment?.method ?? null,
            paymentAmount: input.payment?.amount ?? null,
            paymentDate: input.payment?.date ?? null,
            updatedAt: new Date(),
          })
      }

      return invoice.id
    })

    revalidatePath(`/clients/${input.leadId}/billing`)
    return { success: true, invoiceId }
  } catch (err) {
    logActionError('billing.action.save_transient_draft', err, { leadId: input.leadId })
    return { error: true, reason: 'failed' }
  }
}

async function guardLeadInvoice(
  leadId: number,
  invoiceId: number,
): Promise<
  { success: true; invoice: Pick<BillInvoiceRow, 'id' | 'docState' | 'leadId'> } | { error: true; reason: DraftErrorReason }
> {
  const user = await requireUser()
  if (!canDraftBilling(user)) return { error: true, reason: 'no_permission' }

  const { gotPermIds } = await getPerms(user)

  const leadQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  const invoice = await db('bill_invoices')
    .where({ id: invoiceId, agencyId: user.agencyId, leadId })
    .first('id', 'docState', 'leadId')
  if (!invoice) return { error: true, reason: 'invoice_not_found' }
  if (invoice.docState !== 'draft') return { error: true, reason: 'invoice_not_draft' }

  return {
    success: true,
    invoice: {
      id: Number(invoice.id),
      docState: invoice.docState,
      leadId: Number(invoice.leadId),
    },
  }
}

function logActionError(channel: string, err: unknown, extra: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err)
  const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
  console.error(channel, JSON.stringify({ ...extra, message: truncated }))
}
