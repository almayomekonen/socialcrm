/**
 * The Questionnaire Builder's domain service: the ONE path by which a
 * questionnaire is drafted, checked, simulated and published.
 *
 * Callers — the server actions and the staff script — pass an agency id they
 * have already authorised; every read and write below is scoped to it.
 *
 * PUBLISH IS NOT ACTIVATION (decision 2026-10-06). Publishing makes a revision
 * the current production-ready definition and updates the runtime's live copy
 * (auto_response_settings.questionnaire) when the agency has a settings row. It
 * never writes `responder`, `enabled` or the master switch, and never creates a
 * settings row. An agency routed to the questionnaire runs the new revision for
 * new conversations; an agency on the AI agent stays on it; a new agency gets a
 * revision and nothing customer-facing.
 *
 * PINNING. Publishing touches no session row. A live session keeps the
 * definition it froze at its first question (processJob); new conversations
 * freeze the current one.
 */
import { db } from '@/config/db'
import { getChannelSettings } from '@/db/autoResponseSettings'
import {
  QUESTIONNAIRE_CHANNEL,
  deleteDraftVersioned,
  getDraft,
  getLatestPublished,
  getPublished,
  getRowById,
  insertDraft,
  updateDraftVersioned,
  type RevisionRow,
} from '@/db/questionnaireRevisions'
import { hasCustomerFacingDash, finalizeCustomerFacingText } from '../../customerFacingText'
import type { QuestionnaireDefinition } from '../definition'
import { checkDefinitionForPublish, convertErrorIssue, type BuilderIssue } from './checks'
import { toDefinition } from './convert'
import { assignIds } from './ids'
import { builderQuestionnaireSchema, type BuilderQuestionnaire, type BuilderQuestionnaireInput } from './model'
import { emptyQuestionnaire } from './skeleton'
import { MAX_SIMULATED_TURNS, simulateConversation, type SimulationResult } from './simulate'
import { draftState, type DraftState } from './draftState'

export type BuilderContext = { agencyId: number; userId: number | null }
export type { DraftState } from './draftState'

export type Failure =
  | { ok: false; reason: 'not_found' | 'revision_not_found' | 'draft_published' | 'history_missing' }
  | { ok: false; reason: 'version_conflict'; currentVersion: number | null }
  | { ok: false; reason: 'draft_exists'; draftId: number }
  | { ok: false; reason: 'draft_out_of_date'; latestRevision: number | null }
  | { ok: false; reason: 'invalid_draft' | 'invalid' | 'not_ready'; issues: BuilderIssue[] }
  | { ok: false; reason: 'owner_draft_exists' }
  | { ok: false; reason: 'too_long' | 'bad_input' }

const asDefinition = (row: RevisionRow) => row.definition as QuestionnaireDefinition

// Reading lives in readState.ts.
export { getBuilderState, listRevisions, getRevision } from './readState'

// ── Draft ─────────────────────────────────────────────────────────────────────

/**
 * The agency's draft: the existing one, or a new copy of the newest published
 * revision (or of `fromRevision`, to restore an older one), or an empty starting
 * point. A restored revision is published as the NEXT revision; history only
 * moves forward.
 */
export async function openDraft(ctx: BuilderContext, opts: { fromRevision?: number } = {}): Promise<({ ok: true } & DraftState) | Failure> {
  const existing = await getDraft(ctx.agencyId)
  if (existing) {
    if (opts.fromRevision !== undefined) return { ok: false, reason: 'draft_exists', draftId: existing.id }
    return { ok: true, ...draftState(existing) }
  }
  const latest = await getLatestPublished(ctx.agencyId)
  let source: QuestionnaireDefinition
  if (opts.fromRevision !== undefined) {
    const from = await getPublished(ctx.agencyId, opts.fromRevision)
    if (!from) return { ok: false, reason: 'revision_not_found' }
    source = asDefinition(from)
  } else if (latest) {
    source = asDefinition(latest)
  } else {
    // A live definition with no recorded revision would be published over
    // blind. The migration backfills these; refuse rather than guess.
    const settings = await getChannelSettings(ctx.agencyId, QUESTIONNAIRE_CHANNEL)
    if (settings?.questionnaire != null) return { ok: false, reason: 'history_missing' }
    const agency = await db('agencies').where({ id: ctx.agencyId }).first('name')
    source = emptyQuestionnaire(typeof agency?.name === 'string' ? agency.name : null)
  }
  const { row } = await insertDraft({
    agencyId: ctx.agencyId,
    definition: { ...source, revision: (latest?.revision ?? 0) + 1 },
    baseRevision: latest?.revision ?? null,
    userId: ctx.userId,
    source: 'builder',
  })
  return { ok: true, ...draftState(row) }
}

/** Customer-facing text cannot contain a dash (the send path rewrites them); store what will be sent. */
function normalizeCustomerText(q: BuilderQuestionnaire): BuilderQuestionnaire {
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

async function whyNotWritable(ctx: BuilderContext, draftId: number, expectedVersion: number): Promise<Failure> {
  const row = await getRowById(ctx.agencyId, draftId)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status === 'published') return { ok: false, reason: 'draft_published' }
  return { ok: false, reason: 'version_conflict', currentVersion: row.draftVersion }
}

/**
 * Save the whole draft (autosave-friendly). Only the version the caller loaded
 * may be replaced: a stale tab gets `version_conflict` with the current version,
 * never a silent overwrite.
 */
export async function saveDraft(
  ctx: BuilderContext,
  input: { draftId: number; expectedVersion: number; questionnaire: BuilderQuestionnaireInput },
): Promise<({ ok: true } & DraftState) | Failure> {
  const parsed = builderQuestionnaireSchema.safeParse(input.questionnaire)
  if (!parsed.success) return { ok: false, reason: 'invalid_draft', issues: [{ code: 'invalid', severity: 'error' }] }

  const row = await getRowById(ctx.agencyId, input.draftId)
  if (!row || row.status !== 'draft' || row.draftVersion !== input.expectedVersion) {
    return whyNotWritable(ctx, input.draftId, input.expectedVersion)
  }

  const ids = assignIds(asDefinition(row), normalizeCustomerText(parsed.data))
  if (ids.ok === false) return { ok: false, reason: 'invalid_draft', issues: [convertErrorIssue(ids.error)] }
  const converted = toDefinition(ids.questionnaire, asDefinition(row).revision)
  if (converted.ok === false) return { ok: false, reason: 'invalid_draft', issues: [convertErrorIssue(converted.error)] }

  const saved = await updateDraftVersioned({
    agencyId: ctx.agencyId,
    id: input.draftId,
    expectedVersion: input.expectedVersion,
    definition: converted.definition,
    userId: ctx.userId ?? 0,
  })
  if (!saved) return whyNotWritable(ctx, input.draftId, input.expectedVersion)
  return { ok: true, ...draftState(saved) }
}

export async function discardDraft(ctx: BuilderContext, input: { draftId: number; expectedVersion: number }): Promise<{ ok: true } | Failure> {
  const gone = await deleteDraftVersioned({ agencyId: ctx.agencyId, id: input.draftId, expectedVersion: input.expectedVersion })
  return gone ? { ok: true } : whyNotWritable(ctx, input.draftId, input.expectedVersion)
}

export async function checkDraft(ctx: BuilderContext, draftId: number): Promise<{ ok: true; ready: boolean; issues: BuilderIssue[] } | Failure> {
  const row = await getRowById(ctx.agencyId, draftId)
  if (!row || row.status !== 'draft') return { ok: false, reason: row ? 'draft_published' : 'not_found' }
  return { ok: true, ...checkDefinitionForPublish(asDefinition(row)) }
}

// ── Simulate ──────────────────────────────────────────────────────────────────

export async function simulate(
  ctx: BuilderContext,
  input: { draftId?: number; revision?: number; turns: unknown },
): Promise<({ ok: true } & SimulationResult) | Failure> {
  const turns = input.turns
  if (!Array.isArray(turns) || !turns.every((t) => Array.isArray(t) && t.length > 0 && t.every((m) => typeof m === 'string' && m.length <= 1000))) {
    return { ok: false, reason: 'bad_input' }
  }
  if (turns.length > MAX_SIMULATED_TURNS) return { ok: false, reason: 'too_long' }

  let row: RevisionRow | null
  if (input.draftId !== undefined) {
    row = await getRowById(ctx.agencyId, input.draftId)
    if (row && row.status !== 'draft') row = null
  } else if (input.revision !== undefined) {
    row = await getPublished(ctx.agencyId, input.revision)
  } else {
    row = (await getDraft(ctx.agencyId)) ?? (await getLatestPublished(ctx.agencyId))
  }
  if (!row) return { ok: false, reason: 'not_found' }
  const definition = asDefinition(row)
  // A definition the worker would refuse cannot be simulated: the result would be a lie.
  const check = checkDefinitionForPublish(definition)
  if (!check.ready) return { ok: false, reason: 'not_ready', issues: check.issues }
  return { ok: true, ...simulateConversation(definition, turns as string[][]) }
}

// Publishing lives in publish.ts: one transaction, one path.
export { publishDraft, publishDefinition } from './publish'
