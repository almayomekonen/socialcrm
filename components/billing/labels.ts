import type { DocumentKind } from '@/db/billing/invoices'
import { documentKindLabel } from '@/lib/billing/documentKinds'
import { PAYMENT_METHOD_OPTIONS, paymentMethodLabel, type PaymentMethod } from '@/lib/billing/payment/methods'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * SCREEN labels for billing codes (Phase E3), display only. Hebrew (the
 * default) returns exactly what the shared producers return —
 * `documentKindLabel`, `paymentMethodLabel`, `PAYMENT_METHOD_OPTIONS` — and
 * those producers are untouched: the PDF renderer and the e-mail keep calling
 * them, in the billing language, whatever the interface language is.
 */

const KIND_KEY: Record<DocumentKind, MessageKey> = {
  invoice: 'leadTabs.billing.kindShort.invoice',
  invoice_receipt: 'leadTabs.billing.kindShort.invoice_receipt',
}

/** The kind chip / noun. Unknown or legacy kinds read "invoice", like `documentKindLabel`. */
export function documentKindDisplay(kind: DocumentKind | null | undefined, locale: UiLocale = 'he'): string {
  if (locale === 'he') return documentKindLabel(kind)
  return translatorFor(locale)(kind === 'invoice_receipt' ? KIND_KEY.invoice_receipt : KIND_KEY.invoice)
}

const METHOD_KEY: Record<PaymentMethod, MessageKey> = {
  cash: 'billing.paymentMethod.cash',
  bank_transfer: 'billing.paymentMethod.bank_transfer',
  credit_card: 'billing.paymentMethod.credit_card',
  check: 'billing.paymentMethod.check',
  digital: 'billing.paymentMethod.digital',
  other: 'billing.paymentMethod.other_method',
}

/** A stored payment-method code. Unknown / empty → '' (as `paymentMethodLabel`). */
export function paymentMethodDisplay(value: string | null | undefined, locale: UiLocale = 'he'): string {
  if (locale === 'he') return paymentMethodLabel(value)
  const key = value ? METHOD_KEY[value as PaymentMethod] : undefined
  return key ? translatorFor(locale)(key) : ''
}

/** The payment-method picker: the stored code is the option id in every language. */
export function paymentMethodOptions(locale: UiLocale = 'he'): Array<{ id: PaymentMethod; name: string }> {
  return PAYMENT_METHOD_OPTIONS.map((o) => ({ id: o.value, name: locale === 'he' ? o.label : paymentMethodDisplay(o.value, locale) }))
}
