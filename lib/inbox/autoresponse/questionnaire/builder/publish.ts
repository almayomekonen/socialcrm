/**
 * Publishing a questionnaire draft: the publish transaction
 * (docs/questionnaire-builder-pr1.md §12), shared by the Builder and the staff
 * script so there is one controlled publication path.
 *
 * PUBLISH IS NOT ACTIVATION. Only the revision row and the runtime's live copy
 * (auto_response_settings.questionnaire, when a settings row exists) are
 * written — never `responder`, `enabled` or the master switch, and no settings
 * row is ever created. No session row is touched: live sessions stay on the
 * definition they froze.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { QUESTIONNAIRE_CHANNEL, deleteDraftVersioned, getDraft, getLatestPublished, insertDraft } from '@/db/questionnaireRevisions'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '../definition'
import { checkDefinitionForPublish } from './checks'
import type { BuilderContext, Failure } from './service'

// ── Publish ───────────────────────────────────────────────────────────────────

export type Published = { ok: true; revision: number; publishedAt: string; alreadyPublished?: true }

/**
 * The publish transaction (docs/questionnaire-builder-pr1.md §12). Locks the
 * draft row (serialising double clicks and concurrent publishers), then the
 * settings row; checks the draft was based on the newest revision; validates
 * with the runtime schema; turns the draft row into revision N+1; updates the
 * live definition. Nothing else. Any failure rolls everything back.
 */
async function publishLocked(trx: Knex.Transaction, ctx: BuilderContext, draftId: number, expectedVersion: number): Promise<Published | Failure> {
  const row = await trx('questionnaire_revisions')
    .where({ id: draftId, agencyId: ctx.agencyId, channel: QUESTIONNAIRE_CHANNEL })
    .forUpdate()
    .first()
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status === 'published') {
    // A repeat of a publish that already happened: same answer, no second revision.
    if (Number(row.draftVersion) === expectedVersion) {
      return { ok: true, revision: Number(row.revision), publishedAt: new Date(row.publishedAt).toISOString(), alreadyPublished: true }
    }
    return { ok: false, reason: 'version_conflict', currentVersion: Number(row.draftVersion) }
  }
  if (Number(row.draftVersion) !== expectedVersion) {
    return { ok: false, reason: 'version_conflict', currentVersion: Number(row.draftVersion) }
  }

  const settings = await trx('auto_response_settings')
    .where({ agencyId: ctx.agencyId, channel: QUESTIONNAIRE_CHANNEL })
    .forUpdate()
    .first('questionnaire')
  const latest = await getLatestPublished(ctx.agencyId, trx)
  const base = row.baseRevision == null ? null : Number(row.baseRevision)
  if (base !== (latest?.revision ?? null)) return { ok: false, reason: 'draft_out_of_date', latestRevision: latest?.revision ?? null }

  const liveRevision = Number((settings?.questionnaire as { revision?: unknown } | null)?.revision) || 0
  const next = Math.max(latest?.revision ?? 0, liveRevision) + 1
  const stored = typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition
  const definition = { ...stored, revision: next } as QuestionnaireDefinition
  const check = checkDefinitionForPublish(definition)
  if (!check.ready) return { ok: false, reason: 'invalid', issues: check.issues }

  const updated = await trx('questionnaire_revisions')
    .where({ id: draftId, agencyId: ctx.agencyId, status: 'draft', draftVersion: expectedVersion })
    .update({
      status: 'published',
      revision: next,
      definition: JSON.stringify(definition),
      publishedBy: ctx.userId,
      publishedAt: trx.fn.now(),
      updatedBy: ctx.userId,
      updatedAt: trx.fn.now(),
    })
    .returning(['publishedAt'])
  if (updated.length !== 1) return { ok: false, reason: 'version_conflict', currentVersion: null }

  // The live copy only — never routing. No settings row → none is created.
  if (settings) {
    await trx('auto_response_settings')
      .where({ agencyId: ctx.agencyId, channel: QUESTIONNAIRE_CHANNEL })
      .update({ questionnaire: JSON.stringify(definition), updatedAt: trx.fn.now(), ...(ctx.userId ? { updatedBy: ctx.userId } : {}) })
  }
  return { ok: true, revision: next, publishedAt: new Date(updated[0].publishedAt).toISOString() }
}

/** Rolls back on any failure: a refused publish leaves the draft a draft and everything else untouched. */
class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure.reason)
  }
}

async function inTransaction(fn: (trx: Knex.Transaction) => Promise<Published | Failure>): Promise<Published | Failure> {
  try {
    return await db.transaction(async (trx) => {
      const result = await fn(trx)
      if (result.ok === false) throw new Refused(result)
      return result
    })
  } catch (err) {
    if (err instanceof Refused) return err.failure
    throw err
  }
}

export async function publishDraft(ctx: BuilderContext, input: { draftId: number; expectedVersion: number }): Promise<Published | Failure> {
  const result = await inTransaction((trx) => publishLocked(trx, ctx, input.draftId, input.expectedVersion))
  if (result.ok && !result.alreadyPublished) {
    await track({ agencyId: ctx.agencyId, event: 'questionnaire_published', props: { revision: result.revision, source: 'builder' } })
  }
  return result
}

/**
 * Staff publication (scripts/questionnaire/configure.ts): a complete runtime
 * definition, published through the same transaction as the Builder. Refuses
 * while the owner has a draft open, unless told to discard it.
 */
export async function publishDefinition(args: {
  agencyId: number
  definition: unknown
  discardDraft?: boolean
}): Promise<Published | Failure> {
  const parsed = parseQuestionnaireDefinition(args.definition)
  if (parsed.ok === false) return { ok: false, reason: 'invalid', issues: [{ code: 'invalid', severity: 'error' }] }
  const ctx: BuilderContext = { agencyId: args.agencyId, userId: null }
  const result = await inTransaction(async (trx) => {
    const draft = await getDraft(args.agencyId, trx)
    if (draft) {
      if (!args.discardDraft) return { ok: false, reason: 'owner_draft_exists' }
      await deleteDraftVersioned({ agencyId: args.agencyId, id: draft.id, expectedVersion: draft.draftVersion }, trx)
    }
    const latest = await getLatestPublished(args.agencyId, trx)
    const { row, created } = await insertDraft(
      { agencyId: args.agencyId, definition: parsed.definition, baseRevision: latest?.revision ?? null, userId: null, source: 'staff' },
      trx,
    )
    // An owner opened a draft between the check above and this insert: the
    // insert returned THEIR draft. Never publish it under the staff definition.
    if (!created) return { ok: false, reason: 'owner_draft_exists' }
    return publishLocked(trx, ctx, row.id, row.draftVersion)
  })
  if (result.ok) {
    await track({ agencyId: args.agencyId, event: 'questionnaire_published', props: { revision: result.revision, source: 'staff' } })
  }
  return result
}
