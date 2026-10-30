import type { FieldDescriptor } from '@/lib/billing/issuer/fields'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * DISPLAY-ONLY wording of the issuer registry for the issue flow's identity
 * dialog (Phase E3). The registry (`lib/billing/issuer/fields.ts`) is the source
 * of truth and is unchanged — keys, option VALUES, sanitizers and validators are
 * the registry's own objects. Hebrew returns the registry array itself; other
 * languages get copies whose label / help / placeholder / option wording comes
 * from `billing.issuer.*` by field KEY and option CODE. A field or option with
 * no catalog entry keeps the registry's text.
 */

type FieldKeys = { label: MessageKey; help?: MessageKey; placeholder?: MessageKey }

const FIELD_KEYS: Record<string, FieldKeys> = {
  name: { label: 'billing.issuer.field.name.label', help: 'billing.issuer.field.name.help', placeholder: 'billing.issuer.field.name.placeholder' },
  businessType: { label: 'billing.issuer.field.businessType.label', help: 'billing.issuer.field.businessType.help' },
  taxId: { label: 'billing.issuer.field.taxId.label', help: 'billing.issuer.field.taxId.help' },
  // Tier 2 (the settings business-details page, Phase E4).
  address: { label: 'billing.issuer.field.address.label', help: 'billing.issuer.field.address.help', placeholder: 'billing.issuer.field.address.placeholder' },
  phone: { label: 'billing.issuer.field.phone.label' },
  email: { label: 'billing.issuer.field.email.label', help: 'billing.issuer.field.email.help' },
  img: { label: 'billing.issuer.field.img.label', help: 'billing.issuer.field.img.help' },
}

const OPTION_KEYS: Record<string, { label: MessageKey; description: MessageKey }> = {
  exempt: { label: 'billing.issuer.businessType.exempt.label', description: 'billing.issuer.businessType.exempt.description' },
  authorized: { label: 'billing.issuer.businessType.authorized.label', description: 'billing.issuer.businessType.authorized.description' },
  company: { label: 'billing.issuer.businessType.company.label', description: 'billing.issuer.businessType.company.description' },
}

export function localizeIssuerFields(fields: ReadonlyArray<FieldDescriptor>, locale: UiLocale): ReadonlyArray<FieldDescriptor> {
  if (locale === 'he') return fields
  const t = translatorFor(locale)
  return fields.map((field) => {
    const keys = FIELD_KEYS[field.key]
    if (!keys) return field
    return {
      ...field,
      label: t(keys.label),
      helpText: keys.help ? t(keys.help) : field.helpText,
      placeholder: keys.placeholder ? t(keys.placeholder) : field.placeholder,
      options: field.options?.map((o) => (OPTION_KEYS[o.value] ? { value: o.value, label: t(OPTION_KEYS[o.value].label), description: t(OPTION_KEYS[o.value].description) } : o)),
    }
  })
}

/**
 * The registry's validators return Hebrew sentences (no codes; shared with the
 * server's identity action, unchanged). The dialog shows them in the interface
 * language by the exact sentence; an unknown sentence is shown as returned.
 * `billing.issuer.error.*` in Hebrew equals these sentences (pinned by a test).
 */
const HEBREW = translatorFor('he')
const ERROR_KEYS: Record<string, MessageKey> = Object.fromEntries(
  (
    [
      'billing.issuer.error.nameRequired',
      'billing.issuer.error.businessTypeRequired',
      'billing.issuer.error.taxIdRequired',
      'billing.issuer.error.taxIdInvalid',
      'billing.issuer.error.emailInvalid',
    ] as const
  ).map((key) => [HEBREW(key), key]),
)

export function localizeIssuerError(error: string | undefined, locale: UiLocale): string | undefined {
  if (!error || locale === 'he') return error
  const key = ERROR_KEYS[error]
  return key ? translatorFor(locale)(key) : error
}
