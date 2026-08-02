import type { EventDefinition } from './catalog/types'
import type { Condition } from './conditions'
import { describeCondition } from './conditions'
import type { Timing } from './timing'

/**
 * "One automation = one sentence" (frozen spec §1) — now generated ENTIRELY
 * from catalog metadata.
 *
 * B3 removed this file's hardcoded status labels, source labels and per-trigger
 * branching. The trigger phrase is the event's own declared title; the
 * condition phrases come from the event's declared fields and their options.
 * A new event gets a correct sentence with no change here.
 */

export function timingPhrase(timing: Timing): string {
  if (timing.kind === 'preset') {
    if (timing.preset === 'immediate') return 'מיד'
    return timing.preset === 'one_hour' ? 'אחרי שעה' : 'אחרי יום'
  }
  const unit = timing.unit === 'hours' ? (timing.value === 1 ? 'שעה' : 'שעות') : timing.value === 1 ? 'יום' : 'ימים'
  return timing.value === 1 ? `אחרי ${unit}` : `אחרי ${timing.value} ${unit}`
}

/** The event's own title, as declared in the catalog. */
export function triggerPhrase(event: EventDefinition | null): string {
  return event?.title ?? 'אירוע שאינו זמין'
}

export function conditionsPhrase(event: EventDefinition | null, conditions: readonly Condition[]): string | null {
  if (!event || conditions.length === 0) return null
  return conditions.map((c) => describeCondition(event, c)).join(' וגם ')
}

/** The full card line: כש… · רק אם… · שולח… · מתי. */
export function automationSentence(input: {
  event: EventDefinition | null
  conditions: readonly Condition[]
  actionTitle: string
  subject: string
  timing: Timing
}): string {
  const parts = [triggerPhrase(input.event)]
  const conditions = conditionsPhrase(input.event, input.conditions)
  if (conditions) parts.push(`רק אם ${conditions}`)
  parts.push(input.subject ? `${input.actionTitle}: "${input.subject}"` : input.actionTitle)
  parts.push(timingPhrase(input.timing))
  return parts.join(' · ')
}
