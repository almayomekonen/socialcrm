import { ISSUER_FIELDS, type FieldTier } from './fields'

export type ValidationResult = { ok: true } | { ok: false; errors: Record<string, string> }

export function validateIssuerValues(values: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {}

  const sanitized: Record<string, unknown> = { ...values }
  for (const field of ISSUER_FIELDS) {
    if (!(field.key in sanitized)) continue
    if (field.sanitize) {
      sanitized[field.key] = field.sanitize(sanitized[field.key])
    }
  }

  for (const field of ISSUER_FIELDS) {
    if (!(field.key in sanitized)) continue

    const result = field.validate(sanitized[field.key], sanitized)
    if (result !== true) {
      errors[field.key] = result
    }
  }

  if (Object.keys(errors).length === 0) return { ok: true }
  return { ok: false, errors }
}

export function validateIssuerValuesForTier(values: Record<string, unknown>, tiers: ReadonlyArray<FieldTier>): ValidationResult {
  const keysInTier = ISSUER_FIELDS.filter((f) => tiers.includes(f.tier)).map((f) => f.key)
  const filtered: Record<string, unknown> = {}
  for (const key of keysInTier) {
    if (key in values) filtered[key] = values[key]
  }
  return validateIssuerValues(filtered)
}
