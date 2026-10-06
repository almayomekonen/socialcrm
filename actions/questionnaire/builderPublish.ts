'use server'

/**
 * Questionnaire Builder — simulating, publishing and revision history.
 *
 * Publishing makes a revision production-ready; it never turns routing on or
 * off (builder/publish.ts). The agency is never taken from the input.
 */
import { authorizeBuilder, idFrom } from '@/lib/inbox/autoresponse/questionnaire/builder/authorize'
import {
  getRevision,
  listRevisions,
  publishDraft,
  simulate,
} from '@/lib/inbox/autoresponse/questionnaire/builder/service'

const FORBIDDEN = { ok: false as const, reason: 'forbidden' as const }
const BAD_INPUT = { ok: false as const, reason: 'bad_input' as const }

export async function simulateQuestionnaireDraft(input: { draftId?: unknown; revision?: unknown; turns: unknown }) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  const draftId = input.draftId === undefined ? undefined : idFrom(input.draftId)
  const revision = input.revision === undefined ? undefined : idFrom(input.revision)
  if (draftId === null || revision === null) return BAD_INPUT
  return simulate(ctx, { draftId, revision, turns: input.turns })
}

export async function publishQuestionnaireDraft(input: { draftId: unknown; expectedVersion: unknown }) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  const draftId = idFrom(input.draftId)
  const expectedVersion = idFrom(input.expectedVersion)
  if (!draftId || !expectedVersion) return BAD_INPUT
  return publishDraft(ctx, { draftId, expectedVersion })
}

export async function listQuestionnaireRevisions() {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  return { ok: true as const, revisions: await listRevisions(ctx) }
}

export async function getQuestionnaireRevision(input: { revision: unknown }) {
  const ctx = await authorizeBuilder()
  if (!ctx) return FORBIDDEN
  const revision = idFrom(input.revision)
  return revision ? getRevision(ctx, revision) : BAD_INPUT
}
