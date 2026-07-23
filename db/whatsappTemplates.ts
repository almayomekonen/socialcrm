import type { Knex } from 'knex'
import { db } from '@/config/db'
import type {
  MetaComponent,
  Template,
  TemplateCategory,
  TemplateStatus,
  TemplateVariable,
} from '@/lib/whatsapp/templates/types'
import { failureTextForRejectionKey } from '@/lib/whatsapp/templates/statusCopy'

/**
 * Repository for `whatsapp_templates` — the sole owner of that table's SQL.
 *
 * Agency-scoped by construction: every query takes an agencyId and is bound to it,
 * so a caller can never read another tenant's templates. Rows are mapped to the
 * UI-shaped `Template` here (Meta terms stripped, rejection copy resolved
 * server-side) — the same "map on the server, render on the client" rule as
 * `db/inboxMessages.ts`.
 *
 * Sprint 1 surface only: listTemplates, countByStatus, upsertFromMeta, mapper.
 * insertOptimistic (Sprint 3) and archive/discard (Sprint 5) are added later.
 */

/** Columns the list read selects — one list so the mapper and query cannot drift. */
const LIST_COLUMNS = [
  'id',
  'status',
  'displayTitle',
  'bodyText',
  'variables',
  'rejectionReason',
  'archivedAt',
  'createdAt',
] as const

function safeParse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toVariables(raw: unknown): TemplateVariable[] {
  const val = safeParse(raw)
  return Array.isArray(val) ? (val as TemplateVariable[]) : []
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v ? String(v) : ''
}

/**
 * Row → UI-shaped Template. `failureText` is resolved here (server-side) and is
 * non-null only when the status is `rejected`; it is never a raw Meta reason.
 */
export function mapTemplateRow(r: Record<string, unknown>): Template {
  const status = r.status as TemplateStatus
  return {
    id: Number(r.id),
    displayTitle: (r.displayTitle as string) ?? '',
    status,
    bodyText: (r.bodyText as string) ?? '',
    variables: toVariables(r.variables),
    failureText:
      status === 'rejected' ? failureTextForRejectionKey((r.rejectionReason as string | null) ?? 'generic') : null,
    archived: r.archivedAt != null,
    createdAt: toIso(r.createdAt),
  }
}

export type ListTemplatesOpts = { includeArchived?: boolean }

/** Agency-scoped list, newest first. Excludes archived rows unless asked. */
export async function listTemplates(agencyId: number, opts: ListTemplatesOpts = {}): Promise<Template[]> {
  const q = db('whatsapp_templates').where({ agencyId })
  if (!opts.includeArchived) q.whereNull('archivedAt')
  const rows = await q.orderBy('createdAt', 'desc').select(...LIST_COLUMNS)
  return rows.map(mapTemplateRow)
}

/** Header-badge counts by status, agency-scoped (excludes archived). */
export async function countByStatus(agencyId: number): Promise<Partial<Record<TemplateStatus, number>>> {
  const rows = (await db('whatsapp_templates')
    .where({ agencyId })
    .whereNull('archivedAt')
    .groupBy('status')
    .select('status')
    .count({ count: '*' })) as { status: TemplateStatus; count: string | number }[]

  const out: Partial<Record<TemplateStatus, number>> = {}
  for (const r of rows) out[r.status] = Number(r.count)
  return out
}

export type UpsertFromMetaInput = {
  agencyId: number
  wabaId: string
  name: string
  language?: string
  category: string
  status: string
  metaTemplateId?: string | null
  rejectionReason?: string | null
  qualityRating?: string | null
  displayTitle?: string
  bodyText?: string
  components?: unknown
  variables?: unknown
}

/**
 * Idempotent upsert keyed by Meta's identity (wabaId, name, language). Used by the
 * webhook + reconcile cron (Sprint 4). The conflict path updates only the volatile,
 * Meta-owned fields (status / rejection / quality / metaTemplateId) — the
 * owner-authored fields (displayTitle, variables, bodyText, components) are set on
 * insert and left intact, so a status webhook never clobbers the owner's content.
 *
 * `conn` is injectable for the reconcile cron / tests; app callers use the default.
 */
export async function upsertFromMeta(input: UpsertFromMetaInput, conn: Knex = db): Promise<void> {
  const language = input.language ?? 'he'
  await conn('whatsapp_templates')
    .insert({
      agencyId: input.agencyId,
      wabaId: input.wabaId,
      metaTemplateId: input.metaTemplateId ?? null,
      name: input.name,
      displayTitle: input.displayTitle ?? input.name,
      language,
      category: input.category,
      status: input.status,
      rejectionReason: input.rejectionReason ?? null,
      qualityRating: input.qualityRating ?? null,
      components: JSON.stringify(input.components ?? []),
      bodyText: input.bodyText ?? '',
      variables: JSON.stringify(input.variables ?? []),
      updatedAt: conn.fn.now(),
    })
    .onConflict(['wabaId', 'name', 'language'])
    .merge({
      metaTemplateId: input.metaTemplateId ?? null,
      status: input.status,
      rejectionReason: input.rejectionReason ?? null,
      qualityRating: input.qualityRating ?? null,
      updatedAt: conn.fn.now(),
    })
}

export type TemplateMutationRow = {
  id: number
  status: TemplateStatus
  name: string
  metaTemplateId: string | null
}

/** Load the fields the mutation actions need, agency-scoped. Null if not this agency's. */
export async function loadTemplateForMutation(id: number, agencyId: number): Promise<TemplateMutationRow | null> {
  const row = await db('whatsapp_templates').where({ id, agencyId }).first('id', 'status', 'name', 'metaTemplateId')
  if (!row) return null
  return {
    id: Number(row.id),
    status: row.status as TemplateStatus,
    name: row.name as string,
    metaTemplateId: (row.metaTemplateId as string | null) ?? null,
  }
}

/** Local archive (RFC §4): set archivedAt, agency-scoped. Meta template is retained. */
export async function archiveTemplateRow(id: number, agencyId: number): Promise<number> {
  return db('whatsapp_templates')
    .where({ id, agencyId })
    .whereNull('archivedAt')
    .update({ archivedAt: db.fn.now(), updatedAt: db.fn.now() })
}

/** Local removal (RFC §4 discard): delete the row, agency-scoped. */
export async function discardTemplateRow(id: number, agencyId: number): Promise<number> {
  return db('whatsapp_templates').where({ id, agencyId }).del()
}

export type InsertOptimisticInput = {
  agencyId: number
  wabaId: string
  metaTemplateId: string
  name: string
  displayTitle: string
  language: string
  category: TemplateCategory
  bodyText: string
  components: MetaComponent[]
  variables: TemplateVariable[]
  createdByUserId: number
}

/**
 * Persist a locally-`pending` row after Meta accepted the create (Sprint 3). The
 * status is `pending` because Meta's approval is asynchronous — the webhook/cron
 * (Sprint 4) later moves it to approved/rejected. Returns the UI-shaped Template
 * (with its real DB id) so the client can reconcile its optimistic placeholder.
 */
export async function insertOptimistic(input: InsertOptimisticInput): Promise<Template> {
  const [row] = await db('whatsapp_templates')
    .insert({
      agencyId: input.agencyId,
      wabaId: input.wabaId,
      metaTemplateId: input.metaTemplateId,
      name: input.name,
      displayTitle: input.displayTitle,
      language: input.language,
      category: input.category,
      status: 'pending',
      components: JSON.stringify(input.components),
      bodyText: input.bodyText,
      variables: JSON.stringify(input.variables),
      createdByUserId: input.createdByUserId,
    })
    .returning([...LIST_COLUMNS])
  return mapTemplateRow(row)
}
