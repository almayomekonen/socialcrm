/** A draft row, as the Builder API returns it: the owner's model, the derived view, and readiness. */
import type { RevisionRow } from '@/db/questionnaireRevisions'
import type { QuestionnaireDefinition } from '../definition'
import { checkDefinitionForPublish, type BuilderIssue } from './checks'
import { toBuilder } from './convert'
import type { BuilderQuestionnaire } from './model'
import { describeQuestionnaire, type QuestionnaireView } from './view'

export type DraftState = {
  draftId: number
  draftVersion: number
  baseRevision: number | null
  updatedAt: string
  questionnaire: BuilderQuestionnaire
  view: QuestionnaireView
  ready: boolean
  issues: BuilderIssue[]
}

export function draftState(row: RevisionRow): DraftState {
  const definition = row.definition as QuestionnaireDefinition
  const check = checkDefinitionForPublish(definition)
  return {
    draftId: row.id,
    draftVersion: row.draftVersion,
    baseRevision: row.baseRevision,
    updatedAt: row.updatedAt,
    questionnaire: toBuilder(definition),
    view: describeQuestionnaire(definition),
    ready: check.ready,
    issues: check.issues,
  }
}
