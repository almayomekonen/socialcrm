/**
 * "What kind of answer are we expecting?" for a free-text question, applied
 * the same way from either view (Conversation and Flow edit one draft).
 *
 * `location` is a preset over the runtime's meaningful-answer check; date and
 * location also fill in a not-understood message when the owner has none.
 * Pure: model in, model out.
 */
import {
  keyOf,
  setAnswerKind,
  setNotSetAllowed,
  updateQuestion,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { DATE_PRESET, LOCATION_PRESET, textCheckOf, type TextCheck } from './builderCopy'

export function applyTextCheck(m: BuilderQuestionnaire, key: string, next: TextCheck): BuilderQuestionnaire {
  const q = m.questions.find((x) => keyOf(x) === key)
  if (!q) return m
  const messages = q.messages ?? {}
  if (next === 'none') return setAnswerKind(m, key, 'text_unchecked')
  if (next === 'date') {
    // The preset's message invites "לא נקבע", so the answer it invites is accepted.
    const dated = setNotSetAllowed(setAnswerKind(m, key, 'date'), key, true)
    return messages.notUnderstood
      ? dated
      : updateQuestion(dated, key, { messages: { ...messages, notUnderstood: DATE_PRESET.notUnderstood } })
  }
  const meaningful = setAnswerKind(m, key, 'text')
  if (next !== 'location') return meaningful
  const located = setNotSetAllowed(meaningful, key, true)
  return messages.notUnderstood
    ? located
    : updateQuestion(located, key, { messages: { ...messages, notUnderstood: LOCATION_PRESET.notUnderstood } })
}

/** How a free-text question reads today, location recognised by its message (as the Conversation view does). */
export function currentTextCheck(q: BuilderQuestionnaire['questions'][number]): TextCheck {
  const base = textCheckOf(q.answer.kind)
  return base === 'meaningful' && /מיקום|מקום/.test(q.messages?.notUnderstood ?? '') ? 'location' : base
}
