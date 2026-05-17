import type { DocState, FulfillState } from '@/db/billing/invoices'
import { docStateLabel, fulfillStateLabel } from './funcs'

const DOC_STATE_CLASSES: Record<DocState, string> = {
  draft: 'border-gray-200 bg-gray-50 text-gray-600',
  issued: 'border-gray-300 bg-white text-gray-800',
  voided: 'border-gray-200 bg-gray-100 text-gray-500',
  replaced: 'border-gray-200 bg-gray-100 text-gray-500',
}

export function DocStateChip({ state }: { state: DocState }) {
  return (
    <span
      data-doc-state={state}
      className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full border text-[10px] leading-tight font-medium ${DOC_STATE_CLASSES[state]}`}
    >
      {docStateLabel(state)}
    </span>
  )
}

const FULFILL_STATE_CLASSES: Record<FulfillState, string> = {
  open: 'border-gray-200 bg-gray-50 text-gray-600',
  partial: 'border-gray-200 bg-gray-50 text-gray-700',
  paid: 'border-gray-300 bg-white text-gray-800',
  overdue: 'border-gray-300 bg-gray-100 text-gray-700',
  written_off: 'border-gray-200 bg-gray-100 text-gray-500',
}

export function FulfillStateChip({ state }: { state: FulfillState | null }) {
  if (!state) return null
  return (
    <span
      data-fulfill-state={state}
      className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full border text-[10px] leading-tight font-medium ${FULFILL_STATE_CLASSES[state]}`}
    >
      {fulfillStateLabel(state)}
    </span>
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

const PDF_STATUS_CLASSES: Record<PdfStatus, string> = {
  not_applicable: 'border-gray-200 bg-gray-50 text-gray-500',
  scheduled: 'border-gray-200 bg-gray-50 text-gray-600',
  rendering: 'border-gray-200 bg-gray-50 text-gray-600',
  ready: 'border-gray-300 bg-white text-gray-800',
  failed: 'border-gray-200 bg-gray-100 text-gray-600',
}

export function PdfStatusChip({ status }: { status: PdfStatus }) {
  return (
    <span
      data-pdf-status={status}
      className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full border text-[10px] leading-tight font-medium ${PDF_STATUS_CLASSES[status]}`}
    >
      {PDF_STATUS_LABELS[status]}
    </span>
  )
}
