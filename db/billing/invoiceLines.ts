import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { resolveActiveTaxRateForLine } from './taxRates'
import { computeLineTotals, sumLineTotals, type LineSummary, type LineTotals } from '@/lib/billing/totals'

export { computeLineTotals, sumLineTotals }
export type { LineSummary, LineTotals }

export type AddLineInput = {
  invoiceId: number
  title: string
  description?: string
  quantity: number
  unitPrice: number
  discount?: number
  taxRateId?: number | null
}

export type UpdateLineInput = {
  lineId: number
  title?: string
  description?: string
  quantity?: number
  unitPrice?: number
  discount?: number
  taxRateId?: number | null
}

export async function addInvoiceLine(input: AddLineInput, executor: typeof db = db): Promise<number> {
  const user = await requireUser()

  const invoice = await executor('bill_invoices')
    .where({ id: input.invoiceId, agencyId: user.agencyId, docState: 'draft' })
    .first('id')
  if (!invoice) throw new Error('billing.line.invoice_not_draft')

  const taxRate = await resolveTaxRate(user.agencyId, input.taxRateId ?? null, executor)

  console.log(
    '[w6.trace] addInvoiceLine.resolved',
    JSON.stringify({
      agencyId: user.agencyId,
      invoiceId: input.invoiceId,
      taxRateIdInput: input.taxRateId ?? null,
      resolvedRatePercent: taxRate.ratePercent,
      resolvedTaxRateId: taxRate.id,
    }),
  )

  if (!input.title?.trim()) throw new Error('billing.line.invalid_title')
  const quantity = num(input.quantity, NaN)
  const unitPrice = num(input.unitPrice, NaN)
  const discount = num(input.discount ?? 0, NaN)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('billing.line.invalid_quantity')
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('billing.line.invalid_unit_price')
  if (!Number.isFinite(discount) || discount < 0) throw new Error('billing.line.invalid_discount')

  const totals = computeLineTotals(quantity, unitPrice, discount, taxRate.ratePercent)

  const maxRow = await executor('bill_invoice_lines')
    .where({ invoiceId: input.invoiceId })
    .max<{ max: string | number | null }>('lineNumber as max')
    .first()
  const lineNumber = (Number(maxRow?.max) || 0) + 1

  const [row] = await executor('bill_invoice_lines')
    .insert({
      invoiceId: input.invoiceId,
      agencyId: user.agencyId,
      lineNumber,
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      quantity,
      unitPrice,
      discount,
      taxRateId: taxRate.id,
      taxRatePercentSnapshot: taxRate.ratePercent,
      lineSubtotal: totals.subtotal,
      lineTaxAmount: totals.tax,
      lineTotal: totals.total,
    })
    .returning('id')

  console.log(
    '[w6.trace] addInvoiceLine.inserted',
    JSON.stringify({
      lineId: Number(row.id),
      taxRatePercentSnapshot: taxRate.ratePercent,
      lineSubtotal: totals.subtotal,
      lineTaxAmount: totals.tax,
      lineTotal: totals.total,
    }),
  )

  return Number(row.id)
}

export async function updateInvoiceLine(input: UpdateLineInput): Promise<void> {
  const user = await requireUser()

  const line = await db('bill_invoice_lines as l')
    .join('bill_invoices as i', 'l.invoiceId', 'i.id')
    .where('l.id', input.lineId)
    .andWhere('l.agencyId', user.agencyId)
    .andWhere('i.docState', 'draft')
    .first(
      'l.id as id',
      'l.taxRateId as taxRateId',
      'l.quantity as quantity',
      'l.unitPrice as unitPrice',
      'l.discount as discount',
      'l.taxRatePercentSnapshot as taxRatePercentSnapshot',
    )

  if (!line) throw new Error('billing.line.not_draft_or_not_found')

  const taxRate =
    input.taxRateId !== undefined
      ? await resolveTaxRate(user.agencyId, input.taxRateId)
      : { id: line.taxRateId as number | null, ratePercent: Number(line.taxRatePercentSnapshot) }

  if (input.title !== undefined && !input.title?.trim()) {
    throw new Error('billing.line.invalid_title')
  }
  const quantity = input.quantity !== undefined ? num(input.quantity, NaN) : Number(line.quantity)
  const unitPrice = input.unitPrice !== undefined ? num(input.unitPrice, NaN) : Number(line.unitPrice)
  const discount = input.discount !== undefined ? num(input.discount, NaN) : Number(line.discount)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('billing.line.invalid_quantity')
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('billing.line.invalid_unit_price')
  if (!Number.isFinite(discount) || discount < 0) throw new Error('billing.line.invalid_discount')

  const totals = computeLineTotals(quantity, unitPrice, discount, taxRate.ratePercent)

  const fields: Record<string, unknown> = {
    quantity,
    unitPrice,
    discount,
    taxRateId: taxRate.id,
    taxRatePercentSnapshot: taxRate.ratePercent,
    lineSubtotal: totals.subtotal,
    lineTaxAmount: totals.tax,
    lineTotal: totals.total,
    updatedAt: new Date(),
  }
  if (input.title !== undefined) fields.title = input.title.trim()
  if (input.description !== undefined) fields.description = input.description.trim()

  const updated = await db('bill_invoice_lines').where({ id: input.lineId, agencyId: user.agencyId }).update(fields)
  if (updated === 0) throw new Error('billing.line.update_failed')
}

export async function removeInvoiceLine(lineId: number): Promise<void> {
  const user = await requireUser()

  const line = await db('bill_invoice_lines as l')
    .join('bill_invoices as i', 'l.invoiceId', 'i.id')
    .where('l.id', lineId)
    .andWhere('l.agencyId', user.agencyId)
    .andWhere('i.docState', 'draft')
    .first('l.id as id')

  if (!line) throw new Error('billing.line.not_draft_or_not_found')

  await db('bill_invoice_lines').where({ id: lineId, agencyId: user.agencyId }).del()
}

async function resolveTaxRate(
  agencyId: number,
  taxRateId: number | null,
  executor: typeof db = db,
): Promise<{ id: number | null; ratePercent: number }> {
  if (taxRateId == null) {
    return resolveActiveTaxRateForLine(agencyId, executor)
  }

  const row = await executor('bill_tax_rates').where({ id: taxRateId, agencyId }).first('id', 'ratePercent')
  if (!row) throw new Error('billing.line.tax_rate_not_found')
  return { id: Number(row.id), ratePercent: Number(row.ratePercent) }
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}
