import type { Recipient, ResolvedSend } from './types'
import type { ContentItem } from './content/types'
import { EDUCATIONAL, EDUCATIONAL_KEYS } from './content/educational'
import { deliveredEducationalKeys } from '@/db/emailAutomationSends'
import { renderContentItem } from './contentToAutomation'

/**
 * Pure progression: the next educational item is the FIRST in sequence not yet
 * delivered. A gap (e.g. step 1 and 3 delivered, 2 not) still returns step 2 —
 * the sequence never skips. Returns null when the whole sequence is delivered.
 */
export function pickNextEducational(delivered: Set<string>): ContentItem | null {
  return EDUCATIONAL.find((item) => !delivered.has(item.key)) ?? null
}

/**
 * Progression-based educational journey. The next email is the FIRST item in the
 * ordered EDUCATIONAL sequence that has not yet been delivered to this user.
 *
 * - Never skips: only a delivered ('sent') educational email advances the
 *   position; elapsed days, inactivity, cooldowns, and state-triggered emails
 *   leave the list untouched.
 * - Resumes exactly where it stopped after any interruption.
 * - Returns null once the whole sequence has been delivered.
 */
export async function resolveNextEducational(r: Recipient): Promise<ResolvedSend | null> {
  const delivered = await deliveredEducationalKeys(r.userId, EDUCATIONAL_KEYS)
  const next = pickNextEducational(delivered)
  if (!next) return null
  return {
    key: next.key,
    subject: next.subject,
    template: renderContentItem(next, r),
  }
}
