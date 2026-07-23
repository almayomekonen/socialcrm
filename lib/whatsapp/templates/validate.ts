/**
 * Create-form validation, before anything touches Meta.
 *
 * Pure. Enforces the RFC contract: title + body required and bounded, the purpose
 * question answered (RFC §8), and variables restricted to the CLOSED set (RFC §10)
 * — no free-form variables. Returns Hebrew error messages from the copy registry.
 */
import type { TemplateInput } from './types'
import { ALLOWED_VARIABLE_TOKENS, TEMPLATE_LIMITS, TEMPLATE_VALIDATION_COPY } from './messages'
import { bodyPlaceholders } from './components'

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

export function validateTemplateInput(input: TemplateInput): ValidationResult {
  const errors: string[] = []
  const title = (input?.displayTitle ?? '').trim()
  const body = (input?.bodyText ?? '').trim()

  if (!title) errors.push(TEMPLATE_VALIDATION_COPY.titleRequired)
  else if (title.length > TEMPLATE_LIMITS.titleMax) errors.push(TEMPLATE_VALIDATION_COPY.titleTooLong)

  if (!body) errors.push(TEMPLATE_VALIDATION_COPY.bodyRequired)
  else if (body.length > TEMPLATE_LIMITS.bodyMax) errors.push(TEMPLATE_VALIDATION_COPY.bodyTooLong)

  // Inspect the BODY TEXT itself: our variables are inserted as picker chips
  // (e.g. שם הליד), never as raw braces. Any `{{...}}` typed by hand bypasses the
  // picker and would reach Meta as a parameter with no example → INVALID_FORMAT.
  // Reject it so an invalid payload can never be produced (paired with the
  // assembly guard in createTemplate / hasUnexampledParameters).
  if (body && bodyPlaceholders(body).length > 0) errors.push(TEMPLATE_VALIDATION_COPY.manualPlaceholder)

  if (input?.purpose !== 'UTILITY' && input?.purpose !== 'MARKETING') {
    errors.push(TEMPLATE_VALIDATION_COPY.purposeRequired)
  }

  const hasUnknownVariable = (input?.variables ?? []).some((v) => !ALLOWED_VARIABLE_TOKENS.includes(v.token))
  if (hasUnknownVariable) errors.push(TEMPLATE_VALIDATION_COPY.unknownVariable)

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
