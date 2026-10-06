'use server'

/**
 * Questionnaire Builder — reading and editing the draft.
 *
 * Thin by design: authorise (authorize.ts), validate the shape of the input,
 * call the domain service. The agency is never taken from the input.
 */
import { authorizeBuilder, idFrom } from '@/lib/inbox/autoresponse/questionnaire/builder/authorize'
import {
  checkDraft,
  discardDraft,
  getBuilderState,
  openDraft,
  saveDraft,
} from '@/lib/inbox/autoresponse/questionnaire/builder/service'
import type { BuilderQuestionnaireInput } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

const FORBIDDEN = { ok: false as const, reason: 'forbidden' as const }
const BAD_INPUT = { ok: false as const, reason: 'bad_input' as const }

export async function getQuestionnaireBuilderState() {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  return { ok: true as const, ...(await getBuilderState(ctx)) }
}

export async function openQuestionnaireDraft(input: { fromRevision?: unknown } = {}) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  if (input.fromRevision === undefined) return openDraft(ctx)
  const fromRevision = idFrom(input.fromRevision)
  return fromRevision ? openDraft(ctx, { fromRevision }) : BAD_INPUT
}

export async function saveQuestionnaireDraft(input: { draftId: unknown; expectedVersion: unknown; questionnaire: unknown }) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  const draftId = idFrom(input.draftId)
  const expectedVersion = idFrom(input.expectedVersion)
  if (!draftId || !expectedVersion) return BAD_INPUT
  return saveDraft(ctx, { draftId, expectedVersion, questionnaire: input.questionnaire as BuilderQuestionnaireInput })
}

export async function discardQuestionnaireDraft(input: { draftId: unknown; expectedVersion: unknown }) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  const draftId = idFrom(input.draftId)
  const expectedVersion = idFrom(input.expectedVersion)
  if (!draftId || !expectedVersion) return BAD_INPUT
  return discardDraft(ctx, { draftId, expectedVersion })
}

export async function checkQuestionnaireDraft(input: { draftId: unknown }) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  const draftId = idFrom(input.draftId)
  return draftId ? checkDraft(ctx, draftId) : BAD_INPUT
}
