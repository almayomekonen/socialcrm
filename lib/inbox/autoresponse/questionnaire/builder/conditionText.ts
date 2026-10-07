/**
 * A condition said as a sentence: "סוג האירוע הוא חתונה או חינה".
 *
 * The editor never shows a condition any other way: no ids, no "when", no
 * "anyOf". The meaning matches the runtime (definition.ts `nextStepAfter`):
 * the condition holds when ANY of the chosen answers was given, which reads as
 * "הוא X או Y" for a single choice and "נבחר X או Y" for several.
 */
import { keyOf, optionsOf, type Condition } from './editorBase'
import type { BuilderQuestionnaire } from './model'

function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} או ${items[items.length - 1]}`
}

export function questionName(q: { label: string; prompt: string }): string {
  return q.label.trim() || q.prompt.trim() || 'שאלה ללא שם'
}

/** Null when there is no condition: the question always appears. */
export function describeCondition(m: BuilderQuestionnaire, condition: Condition | null): string | null {
  if (!condition) return null
  const source = m.questions.find((q) => keyOf(q) === condition.questionId)
  if (!source) return 'תלויה בשאלה שנמחקה'
  const labels = condition.anyOf.map(
    (k) =>
      optionsOf(source)
        .find((o) => keyOf(o) === k)
        ?.label.trim() || 'תשובה שנמחקה',
  )
  if (!labels.length) return `${questionName(source)}: עוד לא נבחרה תשובה`
  return source.answer.kind === 'multi_choice'
    ? `בשאלה "${questionName(source)}" נבחר ${joinOr(labels)}`
    : `${questionName(source)} הוא ${joinOr(labels)}`
}
