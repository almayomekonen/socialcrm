/**
 * Questionnaire drafts and published revisions (migration 20261006120000).
 *
 * Every function takes the agency id from its caller and filters on it: a row
 * of another agency is indistinguishable from a row that does not exist.
 * Published rows are immutable in the database (trigger); every write here is
 * conditional on `status = 'draft'` anyway, so a mistake fails loudly twice.
 *
 * The runtime never reads this table. It reads
 * auto_response_settings.questionnaire, which only the publish transaction
 * (questionnaire/builder/service.ts) keeps in step with the newest revision.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'

export const QUESTIONNAIRE_CHANNEL = 'whatsapp'

export type RevisionRow = {
  id: number
  agencyId: number
  channel: string
  status: 'draft' | 'published'
  revision: number | null
  definition: unknown
  draftVersion: number
  baseRevision: number | null
  source: 'builder' | 'staff' | 'backfill'
  createdBy: number | null
  updatedBy: number | null
  updatedAt: string
  publishedBy: number | null
  publishedAt: string | null
}

function mapRow(r: Record<string, unknown>): RevisionRow {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    channel: String(r.channel),
    status: r.status as RevisionRow['status'],
    revision: r.revision == null ? null : Number(r.revision),
    definition: typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition,
    draftVersion: Number(r.draftVersion),
    baseRevision: r.baseRevision == null ? null : Number(r.baseRevision),
    source: r.source as RevisionRow['source'],
    createdBy: r.createdBy == null ? null : Number(r.createdBy),
    updatedBy: r.updatedBy == null ? null : Number(r.updatedBy),
    updatedAt: new Date(r.updatedAt as string).toISOString(),
    publishedBy: r.publishedBy == null ? null : Number(r.publishedBy),
    publishedAt: r.publishedAt == null ? null : new Date(r.publishedAt as string).toISOString(),
  }
}

const scope = (agencyId: number) => ({ agencyId, channel: QUESTIONNAIRE_CHANNEL })

export async function getDraft(agencyId: number, executor: Knex | Knex.Transaction = db): Promise<RevisionRow | null> {
  const row = await executor('questionnaire_revisions').where({ ...scope(agencyId), status: 'draft' }).first()
  return row ? mapRow(row) : null
}

/** Any row of this agency by id — a draft, or a draft that has since been published. */
export async function getRowById(agencyId: number, id: number, executor: Knex | Knex.Transaction = db): Promise<RevisionRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const row = await executor('questionnaire_revisions').where({ ...scope(agencyId), id }).first()
  return row ? mapRow(row) : null
}

export async function getPublished(agencyId: number, revision: number): Promise<RevisionRow | null> {
  if (!Number.isSafeInteger(revision) || revision <= 0) return null
  const row = await db('questionnaire_revisions').where({ ...scope(agencyId), status: 'published', revision }).first()
  return row ? mapRow(row) : null
}

export async function getLatestPublished(agencyId: number, executor: Knex | Knex.Transaction = db): Promise<RevisionRow | null> {
  const row = await executor('questionnaire_revisions')
    .where({ ...scope(agencyId), status: 'published' })
    .orderBy('revision', 'desc')
    .first()
  return row ? mapRow(row) : null
}

export async function listPublished(agencyId: number): Promise<RevisionRow[]> {
  const rows = await db('questionnaire_revisions').where({ ...scope(agencyId), status: 'published' }).orderBy('revision', 'desc')
  return rows.map(mapRow)
}

/**
 * Create the agency's draft, or return the one that already exists: the partial
 * unique index makes a concurrent second insert a no-op, and the loser reads the
 * winner's row.
 */
export async function insertDraft(
  args: { agencyId: number; definition: unknown; baseRevision: number | null; userId: number | null; source: 'builder' | 'staff' },
  executor: Knex | Knex.Transaction = db,
): Promise<{ row: RevisionRow; created: boolean }> {
  const res = await executor.raw(
    `INSERT INTO questionnaire_revisions ("agencyId", channel, status, definition, "baseRevision", source, "createdBy", "updatedBy")
     VALUES (:agencyId, :channel, 'draft', :definition::jsonb, :baseRevision, :source, :userId, :userId)
     ON CONFLICT ("agencyId", channel) WHERE status = 'draft' DO NOTHING
     RETURNING *`,
    {
      agencyId: args.agencyId,
      channel: QUESTIONNAIRE_CHANNEL,
      definition: JSON.stringify(args.definition),
      baseRevision: args.baseRevision,
      source: args.source,
      userId: args.userId,
    },
  )
  const inserted = res.rows?.[0]
  if (inserted) return { row: mapRow(inserted), created: true }
  const existing = await getDraft(args.agencyId, executor)
  if (!existing) throw new Error('questionnaire draft insert raced with a publish; retry')
  return { row: existing, created: false }
}

/** Optimistic save: only the version the caller loaded may be replaced. Null when it was not. */
export async function updateDraftVersioned(args: {
  agencyId: number
  id: number
  expectedVersion: number
  definition: unknown
  userId: number | null
}): Promise<RevisionRow | null> {
  const rows = await db('questionnaire_revisions')
    .where({ ...scope(args.agencyId), id: args.id, status: 'draft', draftVersion: args.expectedVersion })
    .update({
      definition: JSON.stringify(args.definition),
      draftVersion: db.raw('"draftVersion" + 1'),
      updatedBy: args.userId,
      updatedAt: db.fn.now(),
    })
    .returning('*')
  return rows[0] ? mapRow(rows[0]) : null
}

export async function deleteDraftVersioned(
  args: { agencyId: number; id: number; expectedVersion: number },
  executor: Knex | Knex.Transaction = db,
): Promise<boolean> {
  const n = await executor('questionnaire_revisions')
    .where({ ...scope(args.agencyId), id: args.id, status: 'draft', draftVersion: args.expectedVersion })
    .del()
  return Number(n) > 0
}

export async function countActiveSessionsByRevision(agencyId: number): Promise<Array<{ revision: number; count: number }>> {
  const rows = await db('questionnaire_sessions')
    .where({ agencyId, status: 'active' })
    .groupBy('definitionRevision')
    .select('definitionRevision')
    .count<Array<{ definitionRevision: number; count: string }>>('id as count')
  return rows
    .map((r) => ({ revision: Number(r.definitionRevision), count: Number(r.count) }))
    .sort((a, b) => a.revision - b.revision)
}
