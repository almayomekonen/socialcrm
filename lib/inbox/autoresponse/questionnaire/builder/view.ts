/**
 * What the conversation editor shows, derived from the definition. Never stored.
 *
 * For every question, the three things the approved UX makes obvious:
 *   1. מה הלקוח רואה      — `customerSees`, the exact production text
 *                            (render.ts: numbering, icons, the multi-choice hint,
 *                            the נציג hint), never an approximation;
 *   2. איך הוא יכול לענות — `answerSummary`;
 *   3. מתי השאלה מופיעה    — `shownWhenText`.
 * Plus the route outline: for each option of a question that others depend on,
 * which questions follow and which ending is sent.
 */
import type { QuestionnaireDefinition } from '../definition'
import { nextStepAfter } from '../definition'
import { closingFor } from '../closing'
import { renderOpening, renderQuestion } from '../render'

export type QuestionView = {
  id: string
  label: string
  customerSees: string
  answerSummary: string
  shownWhenText: string
}

export type RouteView = {
  questionId: string
  optionId: string
  optionLabel: string
  questionIds: string[]
  /** -1: the standard ending; otherwise the index of the custom ending sent. */
  ending: number
}

export type QuestionnaireView = {
  openingSees: string | null
  questions: QuestionView[]
  routes: RouteView[]
}

function answerSummary(step: QuestionnaireDefinition['steps'][number]): string {
  if (step.type === 'choice') {
    const n = step.options.length
    return `${step.multi === true ? 'כמה אפשרויות' : 'בחירה אחת'} · ${n} ${n === 1 ? 'אפשרות' : 'אפשרויות'}`
  }
  if (step.validate === 'date') return step.allowNotSet ? 'תאריך · אפשר להמשיך גם בלי תאריך' : 'תאריך'
  if (step.validate === 'meaningful') return step.allowNotSet ? 'טקסט · אפשר להמשיך גם אם עדיין לא נקבע' : 'טקסט'
  return 'טקסט'
}

function shownWhenText(definition: QuestionnaireDefinition, step: QuestionnaireDefinition['steps'][number]): string {
  if (!step.when) return 'תמיד'
  const source = definition.steps.find((s) => s.id === step.when?.step)
  const labels =
    source?.type === 'choice'
      ? step.when.anyOf.map((id) => source.options.find((o) => o.id === id)?.label ?? '(אפשרות שנמחקה)')
      : []
  return `רק אם: ${source?.label ?? '(שאלה שנמחקה)'} הוא ${labels.join(', ') || '(לא נבחר)'}`
}

export function describeQuestionnaire(definition: QuestionnaireDefinition): QuestionnaireView {
  const first = nextStepAfter(definition, {}, null)
  const questions = definition.steps.map((step) => ({
    id: step.id,
    label: step.label,
    customerSees: renderQuestion(step),
    answerSummary: answerSummary(step),
    shownWhenText: shownWhenText(definition, step),
  }))

  const branching = definition.steps.filter(
    (s) => s.type === 'choice' && definition.steps.some((other) => other.when?.step === s.id),
  )
  const routes: RouteView[] = []
  for (const q of branching) {
    if (q.type !== 'choice') continue
    for (const option of q.options) {
      const answers = { [q.id]: [option.id] }
      const after = definition.steps.slice(definition.steps.indexOf(q) + 1)
      const questionIds = after.filter((s) => !s.when || (s.when.step === q.id && s.when.anyOf.includes(option.id))).map((s) => s.id)
      const sent = closingFor(definition, answers)
      const ending = (definition.closingVariants ?? []).findIndex((v) => v.text === sent)
      routes.push({ questionId: q.id, optionId: option.id, optionLabel: option.label, questionIds, ending })
    }
  }
  return { openingSees: first ? renderOpening(definition, first) : null, questions, routes }
}
