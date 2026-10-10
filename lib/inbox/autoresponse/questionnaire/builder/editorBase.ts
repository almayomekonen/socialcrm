/**
 * Shared vocabulary of the editor operations (editorOps, editorOptions,
 * editorEndings): identity, conditions, and releasing references to something
 * being removed.
 */
import type { AnswerSpec, BuilderOption, BuilderQuestion, BuilderQuestionnaire } from './model'

export type Keyed = { id?: string; ref?: string }
export type Condition = { questionId: string; anyOf: string[] }
export type QuestionKind = 'single_choice' | 'multi_choice' | 'text' | 'date' | 'text_unchecked'

export function keyOf(entity: Keyed): string {
  return entity.id ?? entity.ref ?? ''
}

/** A stable React key: unchanged when a save gives a new entity its server id. */
export function reactKey(entity: Keyed): string {
  return entity.ref ?? entity.id ?? ''
}

export function newRef(): string {
  return `new_${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`
}

/**
 * The most questions a questionnaire may have: the same 12 the Builder model
 * (model.ts) and the runtime definition (../definition.ts) accept. Every
 * operation that adds a question checks it first and changes nothing when the
 * questionnaire is full, so the editor never holds a draft the save refuses.
 */
export const MAX_QUESTIONS = 12

export function questionsFull(m: BuilderQuestionnaire): boolean {
  return m.questions.length >= MAX_QUESTIONS
}

/** "אחר" as a word of its own: the same rule the publish check uses (checks.ts). */
export const OTHER_LABEL = /(^|\s)אחר(\s|$)/

export const isChoice = (a: AnswerSpec): a is Extract<AnswerSpec, { options: BuilderOption[] }> =>
  a.kind === 'single_choice' || a.kind === 'multi_choice'

export const optionsOf = (q: BuilderQuestion): BuilderOption[] => (isChoice(q.answer) ? q.answer.options : [])

export function conditionOf(q: BuilderQuestion): Condition | null {
  return q.shownWhen.mode === 'all' && q.shownWhen.conditions.length ? q.shownWhen.conditions[0] : null
}

export const newOption = (label = ''): BuilderOption => ({ ref: newRef(), label, phrasings: [] })

export function mapQuestion(
  m: BuilderQuestionnaire,
  key: string,
  f: (q: BuilderQuestion) => BuilderQuestion,
): BuilderQuestionnaire {
  return { ...m, questions: m.questions.map((q) => (keyOf(q) === key ? f(q) : q)) }
}

// ── What depends on what ─────────────────────────────────────────────────────

export type Dependents = { questions: string[]; endings: number[] }

/** Questions and endings that refer to a question, or to some of its options. */
export function dependentsOf(m: BuilderQuestionnaire, questionKey: string, optionKeys?: string[]): Dependents {
  const hits = (c: Condition) => c.questionId === questionKey && (!optionKeys || c.anyOf.some((o) => optionKeys.includes(o)))
  return {
    questions: m.questions.filter((q) => q.shownWhen.mode === 'all' && q.shownWhen.conditions.some(hits)).map(keyOf),
    endings: m.endings.custom.flatMap((e, i) => (e.sentWhen.conditions.some(hits) ? [i] : [])),
  }
}

/** Remove references to a question (or to some of its options) everywhere. */
export function release(m: BuilderQuestionnaire, questionKey: string, optionKeys?: string[]): BuilderQuestionnaire {
  const strip = (c: Condition): Condition | null => {
    if (c.questionId !== questionKey) return c
    if (!optionKeys) return null
    const anyOf = c.anyOf.filter((o) => !optionKeys.includes(o))
    return anyOf.length ? { ...c, anyOf } : null
  }
  const questions = m.questions.map((q) => {
    if (q.shownWhen.mode !== 'all') return q
    const conditions = q.shownWhen.conditions.map(strip).filter((c): c is Condition => c !== null)
    return { ...q, shownWhen: conditions.length ? { mode: 'all' as const, conditions } : { mode: 'always' as const } }
  })
  const custom = m.endings.custom.flatMap((e) => {
    const conditions = e.sentWhen.conditions.map(strip).filter((c): c is Condition => c !== null)
    return conditions.length ? [{ ...e, sentWhen: { mode: 'all' as const, conditions } }] : []
  })
  return { ...m, questions, endings: { ...m.endings, custom } }
}

/**
 * After a save: new entities take the ids the server assigned (ids.ts), and
 * every condition naming their refs follows. Applied to the LATEST local model,
 * so edits made while the save was in flight are kept.
 */
export function adoptIds(m: BuilderQuestionnaire, assigned: Record<string, string>): BuilderQuestionnaire {
  if (!Object.keys(assigned).length) return m
  // The ref stays beside the new id: it is the entity's render key (reactKey),
  // so a card the owner is typing in is not remounted when its save lands.
  // The server ignores a ref on an entity that has an id (ids.ts).
  const swap = <T extends { id?: string; ref?: string }>(e: T): T =>
    e.id || !e.ref || !assigned[e.ref] ? e : { ...e, id: assigned[e.ref] }
  const cond = (c: Condition): Condition => ({
    questionId: assigned[c.questionId] ?? c.questionId,
    anyOf: c.anyOf.map((o) => assigned[o] ?? o),
  })
  return {
    ...m,
    questions: m.questions.map((raw) => {
      const q = swap(raw)
      const answer = isChoice(q.answer) ? { ...q.answer, options: q.answer.options.map(swap) } : q.answer
      const shownWhen =
        q.shownWhen.mode === 'all' ? { mode: 'all' as const, conditions: q.shownWhen.conditions.map(cond) } : q.shownWhen
      return { ...q, answer, shownWhen }
    }),
    endings: {
      ...m.endings,
      custom: m.endings.custom.map((e) => ({
        ...e,
        sentWhen: { mode: 'all' as const, conditions: e.sentWhen.conditions.map(cond) },
      })),
    },
  }
}
