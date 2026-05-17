import { ISSUER_FIELDS, type IssuerData } from './fields'

export type CompletenessResult = { complete: true } | { complete: false; missing: ReadonlyArray<string> }

export function checkIssuerCompleteness(issuer: Partial<IssuerData>): CompletenessResult {
  const missing: string[] = []
  const tier1Fields = ISSUER_FIELDS.filter((f) => f.tier === 1)

  for (const field of tier1Fields) {
    const value = (issuer as Record<string, unknown>)[field.key]
    if (!isPresent(value)) {
      missing.push(field.key)
    }
  }

  if (missing.length === 0) return { complete: true }
  return { complete: false, missing }
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}
