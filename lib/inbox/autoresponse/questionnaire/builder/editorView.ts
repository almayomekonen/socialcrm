/**
 * What the conversation editor shows for the questionnaire being edited: the
 * WhatsApp preview, and every problem attached to the card it belongs to.
 *
 * ONE IMPLEMENTATION. Nothing here formats a message. The unsaved model goes
 * through exactly what a save and a send go through:
 *
 *   normalizeCustomerText (the save's dash rewrite) → toDefinition (convert.ts)
 *   → describeQuestionnaire (view.ts → render.ts, the worker's renderer)
 *   → finalizeCustomerFacingText (the send path's last gate)
 *
 * and the problems come from checkDefinitionForPublish, the same check publish
 * runs on the server. New, unsaved entities stand in with their `ref` as id, so
 * the preview never waits for a save.
 *
 * Browser-safe: this module graph imports nothing but zod (a test enforces it).
 */
import { finalizeCustomerFacingText } from '../../customerFacingText'
import { nextStepAfter, type QuestionnaireDefinition } from '../definition'
import { closingFor } from '../closing'
import { checkDefinitionForPublish, convertErrorIssue, type BuilderIssue } from './checks'
import { toDefinition } from './convert'
import { keyOf } from './editorBase'
import { describeIssue } from './issues'
import type { BuilderQuestionnaire, IdentifiedQuestionnaire } from './model'
import { normalizeCustomerText } from './normalize'
import { describeQuestionnaire } from './view'

export type EditorIssue = BuilderIssue & { text: string }

export type EditorView = {
  /** The first message a customer receives: the opening plus the first question. */
  opening: string | null
  /** Key of the question the opening asks, when there is one. */
  firstQuestionKey: string | null
  /** Each question's message as sent, by question key. */
  messages: Record<string, string>
  endings: { standard: string; custom: string[] }
  ready: boolean
  /** Problems by question key; `''` holds the ones about the questionnaire as a whole. */
  issues: Record<string, EditorIssue[]>
  /** Problems in custom endings, by index. */
  endingIssues: Record<number, EditorIssue[]>
  definition: QuestionnaireDefinition | null
}

/** Stand-in identities for unsaved entities, so the real converter accepts the model. */
function identify(m: BuilderQuestionnaire): IdentifiedQuestionnaire {
  return {
    ...m,
    questions: m.questions.map(({ ref: _ref, ...q }) => ({
      ...q,
      id: keyOf({ id: q.id, ref: _ref }),
      answer:
        q.answer.kind === 'single_choice' || q.answer.kind === 'multi_choice'
          ? { kind: q.answer.kind, options: q.answer.options.map(({ ref, ...o }) => ({ ...o, id: keyOf({ id: o.id, ref }) })) }
          : q.answer,
    })),
  }
}

const send = (text: string) => finalizeCustomerFacingText(text)

/**
 * The unsaved draft as the runtime definition it would be saved as (unsaved
 * entities under their ref). Null only mid-edit, when the converter refuses it.
 * Shared by the preview and the flow map, so both read the same thing.
 */
export function previewDefinition(model: BuilderQuestionnaire): QuestionnaireDefinition | null {
  const converted = toDefinition(identify(normalizeCustomerText(model)), 1)
  return converted.ok ? converted.definition : null
}

export function deriveEditorView(model: BuilderQuestionnaire): EditorView {
  const identified = identify(normalizeCustomerText(model))
  const converted = toDefinition(identified, 1)
  const issues: Record<string, EditorIssue[]> = {}
  const endingIssues: Record<number, EditorIssue[]> = {}
  const file = (issue: BuilderIssue) => {
    const entry = { ...issue, text: describeIssue(issue, identified) }
    if (issue.endingIndex !== undefined) (endingIssues[issue.endingIndex] ??= []).push(entry)
    else (issues[issue.questionId ?? ''] ??= []).push(entry)
  }

  if (converted.ok === false) {
    file(convertErrorIssue(converted.error))
    return {
      opening: null,
      firstQuestionKey: null,
      messages: {},
      endings: { standard: '', custom: [] },
      ready: false,
      issues,
      endingIssues,
      definition: null,
    }
  }

  const definition = converted.definition
  const check = checkDefinitionForPublish(definition)
  check.issues.forEach(file)
  const view = describeQuestionnaire(definition)
  const first = nextStepAfter(definition, {}, null)
  return {
    opening: view.openingSees === null ? null : send(view.openingSees),
    firstQuestionKey: view.openingSees === null ? null : (first?.id ?? null),
    messages: Object.fromEntries(view.questions.map((q) => [q.id, send(q.customerSees)])),
    endings: { standard: send(definition.closing), custom: (definition.closingVariants ?? []).map((v) => send(v.text)) },
    ready: check.ready,
    issues,
    endingIssues,
    definition,
  }
}

/** The ending a customer with these answers receives (closing.ts decides, first match wins). */
export function endingFor(definition: QuestionnaireDefinition, answers: Record<string, string[]>): string {
  return send(closingFor(definition, answers))
}
