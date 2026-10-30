import type { DocState, FulfillState } from '@/db/billing/invoices'
import { docStateLabel, fulfillStateLabel } from './funcs'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

const DOC_STATE_ROLE: Record<DocState, StatusRole> = {
  draft: 'neutral',
  issued: 'neutral',
  voided: 'neutral',
  replaced: 'neutral',
}

/** `locale`: the lead billing list and the invoice screens pass the interface language; default Hebrew. */
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

/** Labels by status CODE; Hebrew is `billing.issued.pdf.*` (the words this chip always showed). */
const PDF_STATUS_KEY: Record<PdfStatus, MessageKey> = {
  not_applicable: 'billing.issued.pdf.not_applicable',
  scheduled: 'billing.issued.pdf.scheduled',
  rendering: 'billing.issued.pdf.rendering',
  ready: 'billing.issued.pdf.ready',
  failed: 'billing.issued.pdf.failed',
}

const PDF_STATUS_ROLE: Record<PdfStatus, StatusRole> = {
  not_applicable: 'neutral',
  scheduled: 'info',
  rendering: 'info',
  ready: 'success',
  failed: 'error',
}

export function PdfStatusChip({ status, locale = 'he' }: { status: PdfStatus; locale?: UiLocale }) {
  return <StatusBadge role={PDF_STATUS_ROLE[status]} label={translatorFor(locale)(PDF_STATUS_KEY[status])} size='xs' data-pdf-status={status} />
}
