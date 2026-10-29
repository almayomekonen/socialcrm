import type { DocState, FulfillState } from '@/db/billing/invoices'
import { docStateLabel, fulfillStateLabel } from './funcs'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import type { UiLocale } from '@/lib/i18n/config'

const DOC_STATE_ROLE: Record<DocState, StatusRole> = {
  draft: 'neutral',
  issued: 'neutral',
  voided: 'neutral',
  replaced: 'neutral',
}

/** `locale`: the lead billing list passes the interface language; the editor (Phase E) passes none and stays Hebrew. */
export function DocStateChip({ state, locale = 'he' }: { state: DocState; locale?: UiLocale }) {
  return <StatusBadge role={DOC_STATE_ROLE[state]} label={docStateLabel(state, locale)} size='xs' data-doc-state={state} />
}

const FULFILL_STATE_ROLE: Record<FulfillState, StatusRole> = {
  open: 'neutral',
  partial: 'warning',
  paid: 'success',
  overdue: 'error',
  written_off: 'neutral',
}

export function FulfillStateChip({ state, locale = 'he' }: { state: FulfillState | null; locale?: UiLocale }) {
  if (!state) return null
  return (
    <StatusBadge role={FULFILL_STATE_ROLE[state]} label={fulfillStateLabel(state, locale)} size='xs' data-fulfill-state={state} />
  )
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
