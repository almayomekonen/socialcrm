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
 *
 * NATURAL ANSWERS (flag, docs/superpowers/specs/2026-10-13-questionnaire-
 * natural-answers-design.md). On a multi question every answer in the turn is
 * unioned instead of newest-wins; a short "אחר" reply is an answer; a
 * single-select reply naming two options is ambiguous; and meaningful words
 * that chose nothing are a NOTE on this question instead of `:unplaced`. A text
 * answer over 300 characters keeps the rest in the note. Off: exactly as above.
 */
import { isQuestionToUs, checkTextAnswer, isCorrection, isFillerOnly } from './validateAnswer'
import { aliasTokens, replyAddsWords } from './aliasMatch'
import { parseChoice, normalizeForMatch } from './parseAnswer'
import { parseSelectionId } from './interactive'
import { answerStateKey, CORRECTIONS_KEY, QUESTIONS_KEY, rawAnswerKey, UNPLACED_KEY } from './answerKeys'
import type { QuestionnaireChoiceStep, QuestionnaireStep } from './definition'
import type { InboundInput } from './transition'
import type { RepromptReason } from './render'
import { readAsOther } from './otherFallback'
import { appendNote, NOTE_MAX_CHARS } from './stepNotes'

export type TurnExtras = { corrections: string[]; questions: string[]; unplaced: string[]; notes: string[] }

export type ReadOutcome =
  | { kind: 'answer'; answer: Record<string, string[]>; extras: TurnExtras }
  | { kind: 'question'; extras: TurnExtras }
  | { kind: 'invalid'; reason: RepromptReason; extras: TurnExtras; candidateIds?: string[] }
  | { kind: 'early_only'; extras: TurnExtras }

type ReadOpts = { natural?: boolean }
type AnswerReading = {
  input: InboundInput
  early: boolean
  as: 'answer'
  answer: Record<string, string[]>
  /** Natural answers: what a text answer said past its 300-character cap. */
  overflow?: string
}
type Reading =
  | AnswerReading
  | { input: InboundInput; early: boolean; as: 'ambiguous'; candidateIds: string[] }
  | { input: InboundInput; early: boolean; as: 'question' | 'correction' | 'other' | 'stale_tap'; tooMany?: true }

const TEXT_ANSWER_MAX = 300
const clip = (text: string) => normalizeForMatch(text).slice(0, TEXT_ANSWER_MAX)

function readChoice(step: QuestionnaireChoiceStep, input: InboundInput, early: boolean, opts: ReadOpts): Reading {
  const words = aliasTokens(input.text)
  const parsed = parseChoice(input.text, step, { natural: opts.natural })
  if (parsed.ok) {
    const keep = parsed.via === 'alias' && replyAddsWords(input.text, step, parsed.optionIds)
    const said = opts.natural ? normalizeForMatch(input.text).slice(0, NOTE_MAX_CHARS) : clip(input.text)
    return { input, early, as: 'answer', answer: { [step.id]: parsed.optionIds, ...(keep ? { [rawAnswerKey(step.id)]: [said] } : {}) } }
  }
  if (isCorrection(words)) return { input, early, as: 'correction' }
  const asks = (words.length >= 2 && /[?؟]/.test(input.text)) || isQuestionToUs(input.text, words)
  if (asks) return { input, early, as: 'question' }
  if (opts.natural && parsed.ok === false && parsed.reason === 'ambiguous') return { input, early, as: 'ambiguous', candidateIds: parsed.candidateIds }
  if (opts.natural) {
    const other = readAsOther(input.text, step)
    if (other) return { input, early, as: 'answer', answer: { [step.id]: [other.optionId], [rawAnswerKey(step.id)]: [other.raw] } }
  }
  const tooMany = parsed.ok === false && parsed.reason === 'too_many'
  return { input, early, as: 'other', ...(tooMany ? { tooMany: true as const } : {}) }
}

function read(step: QuestionnaireStep, input: InboundInput, early: boolean, opts: ReadOpts): Reading {
  if (input.selectedId) {
    const tapped = parseSelectionId(input.selectedId)
    const ok = step.type === 'choice' && tapped?.stepId === step.id && step.options.some((o) => o.id === tapped.optionId)
    return ok ? { input, early, as: 'answer', answer: { [step.id]: [tapped!.optionId] } } : { input, early, as: 'stale_tap' }
  }
  if (step.type === 'choice') return readChoice(step, input, early, opts)
  const full = normalizeForMatch(input.text)
  const value = full.slice(0, TEXT_ANSWER_MAX)
  if (!value) return { input, early, as: 'other' }
  const checked = checkTextAnswer(step, value)
  if (checked.ok === false) {
    return { input, early, as: checked.reason === 'question' ? 'question' : checked.reason === 'correction' ? 'correction' : 'other' }
  }
  const overflow = opts.natural && full.length > TEXT_ANSWER_MAX ? `…${full.slice(TEXT_ANSWER_MAX)}` : undefined
  return {
    input,
    early,
    as: 'answer',
    answer: { [step.id]: [value], ...(checked.notSet ? { [answerStateKey(step.id)]: ['not_set'] } : {}) },
    ...(overflow ? { overflow } : {}),
  }
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

/** Every answer in the turn, in menu order; their words joined for the rep. */
function unionAnswer(step: QuestionnaireChoiceStep, readings: readonly AnswerReading[]): Record<string, string[]> {
  const chosen = new Set(readings.flatMap((r) => r.answer[step.id] ?? []))
  const raws = readings.flatMap((r) => r.answer[rawAnswerKey(step.id)] ?? [])
  return {
    [step.id]: step.options.map((o) => o.id).filter((id) => chosen.has(id)),
    ...(raws.length ? { [rawAnswerKey(step.id)]: [raws.join('; ').slice(0, NOTE_MAX_CHARS)] } : {}),
  }
}

export function readTurn(
  step: QuestionnaireStep,
  inputs: readonly InboundInput[],
  firstAskedAt: number,
  opts: ReadOpts = {},
): ReadOutcome {
  const readings = inputs.map((input) => read(step, input, input.sequence < firstAskedAt, opts))
  const candidates = readings.filter((r): r is AnswerReading => r.as === 'answer' && !r.early)
  const newestWins = step.type === 'choice' || (step.type === 'text' && step.validate === 'date')
  const winner = candidates.length ? (newestWins ? candidates[candidates.length - 1] : candidates[0]) : null
  const notesHere = opts.natural === true && step.type === 'choice'

  const extras: TurnExtras = { corrections: [], questions: [], unplaced: [], notes: [] }
  for (const r of readings) {
    if (r === winner || r.as === 'stale_tap' || !r.input.text.trim()) continue
    // An older answer to THIS question, replaced by (or unioned into) the newer one: not extra information.
    if (newestWins && r.as === 'answer' && !r.early) continue
    const text = clip(r.input.text)
    if (r.as === 'correction') extras.corrections.push(text)
    else if (r.as === 'question') extras.questions.push(text)
    else if (notesHere && !r.early && (r.as === 'other' || r.as === 'ambiguous')) {
      if (saysSomething(text) && !isMenuChatter(text, step)) extras.notes.push(normalizeForMatch(r.input.text))
    } else if (saysSomething(text) && !isMenuChatter(text, step)) extras.unplaced.push(text)
  }
  if (opts.natural && winner?.overflow) extras.notes.push(winner.overflow)

  if (winner) {
    const multi = step.type === 'choice' && step.multi === true
    const answer =
      opts.natural && multi && candidates.length > 1 ? unionAnswer(step as QuestionnaireChoiceStep, candidates) : winner.answer
    return { kind: 'answer', answer, extras }
  }
  const current = readings.filter((r) => !r.early)
  if (!current.length) return { kind: 'early_only', extras }
  if (current.some((r) => r.as === 'question')) return { kind: 'question', extras }
  if (notesHere) {
    const ambiguous = [...current].reverse().find((r) => r.as === 'ambiguous')
    if (ambiguous && ambiguous.as === 'ambiguous') {
      return { kind: 'invalid', reason: 'ambiguous', candidateIds: ambiguous.candidateIds, extras }
    }
    if (extras.notes.length) return { kind: 'invalid', reason: 'noted', extras }
  }
  const tooMany = current.some((r) => r.as === 'other' && 'tooMany' in r && r.tooMany)
  return { kind: 'invalid', reason: step.type === 'choice' ? (tooMany ? 'invalid_multi' : 'invalid_choice') : 'invalid_text', extras }
}

/** Add what this turn kept for the rep, once each, after what earlier turns kept. */
export function withExtras(
  answers: Record<string, string[]>,
  extras: TurnExtras,
  noteStepId?: string,
): Record<string, string[]> {
  const out = { ...answers }
  const add = (key: string, items: string[]) => {
    const prior = out[key] ?? []
    const fresh = items.filter((t, i) => !prior.includes(t) && items.indexOf(t) === i)
    if (fresh.length) out[key] = [...prior, ...fresh]
  }
  add(CORRECTIONS_KEY, extras.corrections)
  add(QUESTIONS_KEY, extras.questions)
  add(UNPLACED_KEY, extras.unplaced)
  return noteStepId && extras.notes.length ? appendNote(out, noteStepId, extras.notes) : out
}
