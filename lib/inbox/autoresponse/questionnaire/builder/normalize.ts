/**
 * What a draft stores is what will be sent. Customer-facing text cannot contain
 * a dash (the send path rewrites them into commas), so saving rewrites them the
 * same way first. The live preview applies this same function, so the owner
 * sees the stored text, not a version the server will change.
 */
import { finalizeCustomerFacingText, hasCustomerFacingDash } from '../../customerFacingText'
import type { BuilderQuestionnaire } from './model'

export function normalizeCustomerText(q: BuilderQuestionnaire): BuilderQuestionnaire {
  const n = (s: string) => (hasCustomerFacingDash(s) ? finalizeCustomerFacingText(s) : s)
  const nOpt = (s: string | undefined) => (s === undefined ? undefined : n(s))
  return {
    ...q,
    opening: n(q.opening),
    handoffMessage: n(q.handoffMessage),
    summaryTitle: n(q.summaryTitle),
    endings: { standard: n(q.endings.standard), custom: q.endings.custom.map((e) => ({ ...e, message: n(e.message) })) },
    questions: q.questions.map((question) => ({
      ...question,
      label: n(question.label),
      prompt: n(question.prompt),
      messages: Object.fromEntries(
        Object.entries(question.messages ?? {})
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, nOpt(v)]),
      ),
      answer:
        question.answer.kind === 'single_choice' || question.answer.kind === 'multi_choice'
          ? { ...question.answer, options: question.answer.options.map((o) => ({ ...o, label: n(o.label) })) }
          : question.answer,
    })),
  }
}
