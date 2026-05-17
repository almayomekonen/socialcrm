/**
 * Visibility tiers for bill_financial_events rows.
 *
 *   - 'user'   appears in the invoice/lead timeline UI. Operator-relevant
 *              domain events (issued, voided, sent, viewed, paid, …).
 *   - 'system' projection recomputes, document renders, automation
 *              evaluations. Internal operational metadata.
 *   - 'audit'  security/audit grade — permission checks fired, page-view
 *              records. Never rendered in any user-facing surface.
 *
 * `defaultVisibilityFor()` is the conservative inference applied when the
 * appender doesn't specify visibility explicitly: known user-visible prefixes
 * resolve to 'user', known internal prefixes to 'system' or 'audit', unknown
 * event types fall back to 'system' so accidental UI leakage requires
 * deliberate opt-in.
 */

export const VISIBILITY_TIERS = ['user', 'system', 'audit'] as const
export type VisibilityTier = (typeof VISIBILITY_TIERS)[number]

const USER_VISIBLE_PREFIXES = [
  'invoice.',
  'receipt.',
  'allocation.',
  'payment.',
  'payment_intent.',
  'communication.',
  'reminder.',
  'writeoff.',
  'write_off.',
]

const SYSTEM_PREFIXES = ['projection.', 'document.', 'automation.']

const AUDIT_PREFIXES = ['audit.']

export function defaultVisibilityFor(eventType: string): VisibilityTier {
  if (USER_VISIBLE_PREFIXES.some((p) => eventType.startsWith(p))) return 'user'
  if (AUDIT_PREFIXES.some((p) => eventType.startsWith(p))) return 'audit'
  if (SYSTEM_PREFIXES.some((p) => eventType.startsWith(p))) return 'system'
  return 'system'
}
