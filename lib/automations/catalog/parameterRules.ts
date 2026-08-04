import { getAction } from './registry'

/**
 * Enforce a parameter's DECLARED validation, read from the catalog.
 *
 * Validation is data, never code (§3.7) — so the rule for a parameter lives in
 * its catalog declaration and is applied from there. A writer that hardcoded
 * `maxLength` or a URL pattern would be a second source of truth, free to drift
 * from what the Builder shows and what the conformance test pins.
 *
 * Only the validators the vocabulary declares are honoured (`PARAMETER_VALIDATORS`):
 * required, maxLength, min, max, pattern, oneOf.
 */
export type ParameterIssue = 'required' | 'too_long' | 'too_small' | 'too_large' | 'pattern' | 'not_allowed'

export function checkParameter(actionKey: string, parameterKey: string, raw: string | null | undefined): ParameterIssue | null {
  const declaration = getAction(actionKey)?.parameters?.find((p) => p.key === parameterKey)
  if (!declaration) return null
  const rules = declaration.validation
  if (!rules) return null

  const value = (raw ?? '').trim()
  if (!value) return rules.required ? 'required' : null

  if (rules.maxLength != null && value.length > rules.maxLength) return 'too_long'
  if (rules.pattern != null && !new RegExp(rules.pattern).test(value)) return 'pattern'
  if (rules.oneOf != null && !rules.oneOf.includes(value)) return 'not_allowed'

  if (rules.min != null || rules.max != null) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      if (rules.min != null && numeric < rules.min) return 'too_small'
      if (rules.max != null && numeric > rules.max) return 'too_large'
    }
  }
  return null
}
