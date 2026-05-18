'use server'

import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'

export type InvoicePdfStatusValue = 'rendering' | 'ready' | 'failed' | 'none'

export type InvoicePdfStatusSnapshot = {
  status: InvoicePdfStatusValue
  url: string | null
  errorReason: string | null
}

export async function getInvoicePdfStatusAction(invoiceId: number): Promise<InvoicePdfStatusSnapshot> {
  const user = await requireUser()

  const current = await db('bill_documents')
    .where({ agencyId: user.agencyId, invoiceId, isCurrent: true })
    .first('status', 'url', 'errorReason')
  if (current) return shape(current)

  const latest = await db('bill_documents')
    .where({ agencyId: user.agencyId, invoiceId })
    .orderBy('createdAt', 'desc')
    .first('status', 'url', 'errorReason')
  if (latest) return shape(latest)

  return { status: 'none', url: null, errorReason: null }
}

function shape(row: { status: unknown; url: unknown; errorReason: unknown }): InvoicePdfStatusSnapshot {
  return {
    status: row.status as InvoicePdfStatusValue,
    url: (row.url as string | null) ?? null,
    errorReason: (row.errorReason as string | null) ?? null,
  }
}
