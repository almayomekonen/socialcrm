/**
 * What a turn's messages say about the question that is open. Pure.
 *
 * ONE MESSAGE IS ONE CANDIDATE. Messages are never joined: "רחובות" and
 * "סטילס" sent together are two messages, and gluing them into one location
 * would be a value nobody wrote. Each message is read on its own and is one of:
 *
 *   answer     — it answers THIS question
 *   question   — the customer asking us something ("כמה זה עולה?")
 *   correction — the customer fixing an EARLIER answer ("טעיתי, 19.11")
 *   other      — anything else
 *
 * ONE WINNER. For a choice or a date, the newest answer wins: "2" then "3" is
 * a customer changing their mind. For broad text, the first wins: "בתל אביב"
 * then "סטילס" is a location and then something else, not a newer location.
 *
 * NOTHING IS LOST. Every other message that says something is kept for the rep
 * (unplaced, questions, corrections). Nothing is filed under a question it was
 * not an answer to, and nothing is guessed into a later question.
 *
 * TOO EARLY TO BE AN ANSWER. A message sent before this question was first
 * asked cannot be its answer: the customer had not seen it. It is kept for the
 * rep instead. (A RE-ask does not count: "לתאריך", then "18.11" before the
 * re-ask arrives, still answers the date.)
 */
import { isQuestionToUs, checkTextAnswer, isCorrection, isFillerOnly } from './validateAnswer'
import { aliasTokens, replyAddsWords } from './aliasMatch'
import { parseChoice, normalizeForMatch } from './parseAnswer'
import { parseSelectionId } from './interactive'
import { answerStateKey, CORRECTIONS_KEY, QUESTIONS_KEY, rawAnswerKey, UNPLACED_KEY } from './answerKeys'
import type { QuestionnaireStep } from './definition'
import type { InboundInput } from './transition'
import type { RepromptReason } from './render'

export type TurnExtras = { corrections: string[]; questions: string[]; unplaced: string[] }

export type ReadOutcome =
  | { kind: 'answer'; answer: Record<string, string[]>; extras: TurnExtras }
  | { kind: 'question'; extras: TurnExtras }
  | { kind: 'invalid'; reason: RepromptReason; extras: TurnExtras }
  | { kind: 'early_only'; extras: TurnExtras }

type Reading =
  | { input: InboundInput; early: boolean; as: 'answer'; answer: Record<string, string[]> }
  | { input: InboundInput; early: boolean; as: 'question' | 'correction' | 'other' | 'stale_tap'; tooMany?: true }

const clip = (text: string) => normalizeForMatch(text).slice(0, 300)

function read(step: QuestionnaireStep, input: InboundInput, early: boolean): Reading {
  if (input.selectedId) {
    const tapped = parseSelectionId(input.selectedId)
    const ok = step.type === 'choice' && tapped?.stepId === step.id && step.options.some((o) => o.id === tapped.optionId)
    return ok ? { input, early, as: 'answer', answer: { [step.id]: [tapped!.optionId] } } : { input, early, as: 'stale_tap' }
  }
  const words = aliasTokens(input.text)
  if (step.type === 'choice') {
    const parsed = parseChoice(input.text, step)
    if (parsed.ok) {
      const keep = parsed.via === 'alias' && replyAddsWords(input.text, step, parsed.optionIds)
      return { input, early, as: 'answer', answer: { [step.id]: parsed.optionIds, ...(keep ? { [rawAnswerKey(step.id)]: [clip(input.text)] } : {}) } }
    }
    if (isCorrection(words)) return { input, early, as: 'correction' }
    const asks = (words.length >= 2 && /[?؟]/.test(input.text)) || isQuestionToUs(input.text, words)
    if (asks) return { input, early, as: 'question' }
    const tooMany = parsed.ok === false && parsed.reason === 'too_many'
    return { input, early, as: 'other', ...(tooMany ? { tooMany: true as const } : {}) }
  }
  const value = clip(input.text)
  if (!value) return { input, early, as: 'other' }
  const checked = checkTextAnswer(step, value)
  if (checked.ok === false) {
    return { input, early, as: checked.reason === 'question' ? 'question' : checked.reason === 'correction' ? 'correction' : 'other' }
  }
  return { input, early, as: 'answer', answer: { [step.id]: [value], ...(checked.notSet ? { [answerStateKey(step.id)]: ['not_set'] } : {}) } }
}

/** "לא, 2" at a menu: talk about the menu itself, not information for the rep. */
function isMenuChatter(text: string, step: QuestionnaireStep): boolean {
  if (step.type !== 'choice') return false
  const words = aliasTokens(text)
  return words.every((w) => (/^\d+$/.test(w) && Number(w) <= step.options.length) || isFillerOnly(w))
}

/** Worth showing the rep: says something beyond fillers and punctuation. */
function saysSomething(text: string): boolean {
  return !isFillerOnly(text)
}

export function readTurn(step: QuestionnaireStep, inputs: readonly InboundInput[], firstAskedAt: number): ReadOutcome {
  const readings = inputs.map((input) => read(step, input, input.sequence < firstAskedAt))
  const candidates = readings.filter((r) => r.as === 'answer' && !r.early)
  const newestWins = step.type === 'choice' || (step.type === 'text' && step.validate === 'date')
  const winner = candidates.length ? (newestWins ? candidates[candidates.length - 1] : candidates[0]) : null

  const extras: TurnExtras = { corrections: [], questions: [], unplaced: [] }
  for (const r of readings) {
    if (r === winner || r.as === 'stale_tap' || !r.input.text.trim()) continue
    // An older answer to THIS question, replaced by the newer one: not extra information.
    if (newestWins && r.as === 'answer' && !r.early) continue
    const text = clip(r.input.text)
    if (r.as === 'correction') extras.corrections.push(text)
    else if (r.as === 'question') extras.questions.push(text)
    else if (saysSomething(text) && !isMenuChatter(text, step)) extras.unplaced.push(text)
  }

  if (winner && winner.as === 'answer') return { kind: 'answer', answer: winner.answer, extras }
  const current = readings.filter((r) => !r.early)
  if (!current.length) return { kind: 'early_only', extras }
  if (current.some((r) => r.as === 'question')) return { kind: 'question', extras }
  const tooMany = current.some((r) => r.as === 'other' && 'tooMany' in r && r.tooMany)
  return { kind: 'invalid', reason: step.type === 'choice' ? (tooMany ? 'invalid_multi' : 'invalid_choice') : 'invalid_text', extras }
}

/** Add what this turn kept for the rep, once each, after what earlier turns kept. */
export function withExtras(answers: Record<string, string[]>, extras: TurnExtras): Record<string, string[]> {
  const out = { ...answers }
  const add = (key: string, items: string[]) => {
    const prior = out[key] ?? []
    const fresh = items.filter((t, i) => !prior.includes(t) && items.indexOf(t) === i)
    if (fresh.length) out[key] = [...prior, ...fresh]
  }
  add(CORRECTIONS_KEY, extras.corrections)
  add(QUESTIONS_KEY, extras.questions)
  add(UNPLACED_KEY, extras.unplaced)
  return out
}
