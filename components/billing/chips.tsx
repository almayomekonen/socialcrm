import type { DocState, FulfillState } from '@/db/billing/invoices'
import { docStateLabel, fulfillStateLabel } from './funcs'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'

const DOC_STATE_ROLE: Record<DocState, StatusRole> = {
  draft: 'neutral',
  issued: 'neutral',
  voided: 'neutral',
  replaced: 'neutral',
}

export function DocStateChip({ state }: { state: DocState }) {
  return <StatusBadge role={DOC_STATE_ROLE[state]} label={docStateLabel(state)} size='xs' data-doc-state={state} />
}

const FULFILL_STATE_ROLE: Record<FulfillState, StatusRole> = {
  open: 'neutral',
  partial: 'warning',
  paid: 'success',
  overdue: 'error',
  written_off: 'neutral',
}

export function FulfillStateChip({ state }: { state: FulfillState | null }) {
  if (!state) return null
  return <StatusBadge role={FULFILL_STATE_ROLE[state]} label={fulfillStateLabel(state)} size='xs' data-fulfill-state={state} />
}

export type PdfStatus = 'scheduled' | 'rendering' | 'ready' | 'failed' | 'not_applicable'

const PDF_STATUS_LABELS: Record<PdfStatus, string> = {
  not_applicable: 'אין מסמך',
  scheduled: 'PDF בקרוב',
  rendering: 'מופק כעת',
  ready: 'מסמך זמין',
  failed: 'שגיאה בהפקה',
}

const PDF_STATUS_ROLE: Record<PdfStatus, StatusRole> = {
  not_applicable: 'neutral',
  scheduled: 'info',
  rendering: 'info',
  ready: 'success',
  failed: 'error',
}

export function PdfStatusChip({ status }: { status: PdfStatus }) {
  return <StatusBadge role={PDF_STATUS_ROLE[status]} label={PDF_STATUS_LABELS[status]} size='xs' data-pdf-status={status} />
}
