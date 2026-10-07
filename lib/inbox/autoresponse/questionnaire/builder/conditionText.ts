/**
 * A condition said as a sentence: 'הלקוח בחר חתונה או חינה בשאלה "סוג האירוע"'.
 *
 * The editor never shows a condition any other way: no ids, no "when", no
 * "anyOf". The meaning matches the runtime (definition.ts `nextStepAfter`):
 * the condition holds when ANY of the chosen answers was given.
 *
 * The answer comes first and the question is quoted, because a question's name
 * is often the question itself ("איזה שירות מעניין אותך"): "X הוא Y" reads
 * wrong for those, "הלקוח בחר Y בשאלה X" reads right for every name.
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
  if (!labels.length) return `בשאלה "${questionName(source)}" עוד לא נבחרה תשובה`
  return `הלקוח בחר ${joinOr(labels)} בשאלה "${questionName(source)}"`
}
