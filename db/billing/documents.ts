import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'

export type DocumentStatus = 'rendering' | 'ready' | 'failed'
export type DocumentKind = 'invoice_pdf' | 'receipt_pdf' | 'statement_pdf'

export type BillDocumentRow = {
  id: number
  agencyId: number
  invoiceId: number
  kind: DocumentKind
  locale: string
  templateVersionId: number
  path: string | null
  url: string | null
  contentHash: string | null
  byteSize: number | null
  status: DocumentStatus
  errorReason: string | null
  isCurrent: boolean
  renderedAt: string | null
  renderedByUserId: number | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type CreatePendingDocumentInput = {
  agencyId: number
  invoiceId: number
  kind?: DocumentKind
  locale?: string
  templateVersionId?: number
  renderedByUserId?: number | null
  metadata?: Record<string, unknown>
}

export async function createPendingDocument(input: CreatePendingDocumentInput): Promise<number> {
  const [row] = await db('bill_documents')
    .insert({
      agencyId: input.agencyId,
      invoiceId: input.invoiceId,
      kind: input.kind ?? 'invoice_pdf',
      locale: input.locale ?? 'he',
      templateVersionId: input.templateVersionId ?? 1,
      status: 'rendering',
      isCurrent: false,
      renderedByUserId: input.renderedByUserId ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .returning('id')

  return Number(row.id)
}

export type MarkReadyInput = {
  documentId: number
  agencyId: number
  invoiceId: number
  path: string
  url: string
  contentHash: string
  byteSize: number
}

export async function markDocumentReady(input: MarkReadyInput): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('bill_documents')
      .where({ agencyId: input.agencyId, invoiceId: input.invoiceId, isCurrent: true })
      .andWhereNot({ id: input.documentId })
      .update({ isCurrent: false })

    const updated = await trx('bill_documents').where({ id: input.documentId, agencyId: input.agencyId }).update({
      status: 'ready',
      path: input.path,
      url: input.url,
      contentHash: input.contentHash,
      byteSize: input.byteSize,
      isCurrent: true,
      renderedAt: new Date(),
    })

    if (updated === 0) throw new Error('billing.document.mark_ready_failed')
  })
}

export async function markDocumentFailed(documentId: number, agencyId: number, errorReason: string): Promise<void> {
  const truncated = errorReason.length > 240 ? errorReason.slice(0, 240) + '…' : errorReason
  await db('bill_documents').where({ id: documentId, agencyId }).update({
    status: 'failed',
    errorReason: truncated,
    renderedAt: new Date(),
  })
}

export async function appendDocumentDiagStep(
  documentId: number,
  agencyId: number,
  step: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const entry = { t: new Date().toISOString(), step, ...(detail ?? {}) }
  await db.raw(
    `update bill_documents
     set metadata = jsonb_set(
       coalesce(metadata, '{}'::jsonb),
       '{diag}',
       coalesce(metadata->'diag', '[]'::jsonb) || ?::jsonb,
       true
     )
     where id = ? and "agencyId" = ?`,
    [JSON.stringify(entry), documentId, agencyId],
  )
}

export async function getCurrentDocumentForInvoice(invoiceId: number): Promise<BillDocumentRow | null> {
  const user = await requireUser()
  const row = await db('bill_documents').where({ agencyId: user.agencyId, invoiceId, isCurrent: true }).first()
  if (row) return normalize(row)

  const latest = await db('bill_documents').where({ agencyId: user.agencyId, invoiceId }).orderBy('createdAt', 'desc').first()
  return latest ? normalize(latest) : null
}

export async function getPendingDocumentForInvoice(agencyId: number, invoiceId: number): Promise<BillDocumentRow | null> {
  const row = await db('bill_documents').where({ agencyId, invoiceId, status: 'rendering' }).orderBy('createdAt', 'desc').first()
  return row ? normalize(row) : null
}

export async function hasReadyDocument(agencyId: number, invoiceId: number): Promise<boolean> {
  const row = await db('bill_documents').where({ agencyId, invoiceId, status: 'ready', isCurrent: true }).first('id')
  return !!row
}

function normalize(raw: Record<string, unknown>): BillDocumentRow {
  return {
    id: Number(raw.id),
    agencyId: Number(raw.agencyId),
    invoiceId: Number(raw.invoiceId),
    kind: raw.kind as DocumentKind,
    locale: String(raw.locale ?? 'he'),
    templateVersionId: Number(raw.templateVersionId ?? 1),
    path: (raw.path as string | null) ?? null,
    url: (raw.url as string | null) ?? null,
    contentHash: (raw.contentHash as string | null) ?? null,
    byteSize: raw.byteSize == null ? null : Number(raw.byteSize),
    status: raw.status as DocumentStatus,
    errorReason: (raw.errorReason as string | null) ?? null,
    isCurrent: !!raw.isCurrent,
    renderedAt: raw.renderedAt instanceof Date ? raw.renderedAt.toISOString() : ((raw.renderedAt as string | null) ?? null),
    renderedByUserId: raw.renderedByUserId == null ? null : Number(raw.renderedByUserId),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : {},
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : String(raw.createdAt),
  }
}
