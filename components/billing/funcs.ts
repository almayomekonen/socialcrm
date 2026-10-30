import type { DocState, DocumentKind, FulfillState } from '@/db/billing/invoices'
import { formatDocumentIdentity, formatDocumentShortNumber } from '@/lib/billing/numbering'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * Billing state labels by CODE. Hebrew (the default) is the catalog's
 * `leadTabs.billing.*`, the exact words these chips always showed. The lead
 * billing list and the invoice screens (Phase E3) pass the interface language.
 * An unknown code is shown as stored.
 */
const DOC_STATE_KEY: Record<DocState, MessageKey> = {
  draft: 'leadTabs.billing.docState.draft',
  issued: 'leadTabs.billing.docState.issued',
  voided: 'leadTabs.billing.docState.voided',
  replaced: 'leadTabs.billing.docState.replaced',
}

const FULFILL_STATE_KEY: Record<FulfillState, MessageKey> = {
  open: 'leadTabs.billing.fulfillState.open',
  partial: 'leadTabs.billing.fulfillState.partial',
  paid: 'leadTabs.billing.fulfillState.paid',
  overdue: 'leadTabs.billing.fulfillState.overdue',
  written_off: 'leadTabs.billing.fulfillState.written_off',
}

const KIND_SHORT_KEY: Record<DocumentKind, MessageKey> = {
  invoice: 'leadTabs.billing.kindShort.invoice',
  invoice_receipt: 'leadTabs.billing.kindShort.invoice_receipt',
}

export function docStateLabel(state: DocState, locale: UiLocale = 'he'): string {
  const key = DOC_STATE_KEY[state]
  return key ? translatorFor(locale)(key) : state
}

export function fulfillStateLabel(state: FulfillState | null, locale: UiLocale = 'he'): string {
  if (!state) return ''
  const key = FULFILL_STATE_KEY[state]
  return key ? translatorFor(locale)(key) : state
}

/**
 * The document's visual identity in a list row. Hebrew is exactly
 * `formatDocumentIdentity` (shared with the email subject and the editor);
 * other languages name the kind in the interface language around the same
 * number (`#00042`), which is data.
 */
export function formatInvoiceNumber(
  invoice: {
    documentNumber: number | null
    documentYear: number | null
    docState: DocState
    kind: DocumentKind
  },
  locale: UiLocale = 'he',
): string {
  const t = translatorFor(locale)
  if (invoice.docState === 'draft' || invoice.documentNumber == null) {
    return t('leadTabs.billing.draftNumber')
  }
  const identity = { documentNumber: invoice.documentNumber, docState: invoice.docState, kind: invoice.kind }
  if (locale === 'he') return formatDocumentIdentity(identity)
  const kindKey = KIND_SHORT_KEY[invoice.kind] ?? KIND_SHORT_KEY.invoice
  return t('leadTabs.billing.identity', { kind: t(kindKey), number: formatDocumentShortNumber(identity) })
}
