import { db } from '@/config/db'
import type { ActionType, TriggerType } from '@/lib/automations/types'
import type { Timing } from '@/lib/automations/timing'
import type { Condition } from '@/lib/automations/conditions'
import { liftFromLegacyColumns, projectToLegacyColumns } from '@/lib/automations/conditions'

/**
 * automation_definitions — user-authored automations as data (ADR-001/008).
 * Hybrid rows: engine-queried facts are columns; rendered content lives in a
 * versioned JSON document (CONTENT_SCHEMA_VERSION). Soft delete ONLY — the
 * activity log and claims reference definitions forever.
 *
 * API: list/get (agency-scoped), listActive/hasActive per trigger (the
 * emission lookup, shaped for the partial active-trigger index),
 * createDefinition, updateDefinitionContent, setDefinitionStatus (lifecycle
 * timestamps recorded; 'deleted' is terminal).
 */

export const CONTENT_SCHEMA_VERSION = 1

export type DefinitionContent = {
  schemaVersion: number
  subject: string
  body: string
  timing: Timing
}

export type DefinitionStatus = 'draft' | 'active' | 'paused' | 'deleted'

/** One entry of the actions LIST. V1 always holds exactly one (frozen spec). */
export type AutomationActionEntry = { actionKey: string; parameters: Record<string, unknown> }

export interface AutomationDefinition {
  id: number
  agencyId: number
  name: string
  recipeKey: string | null
  status: DefinitionStatus
  trigger: TriggerType
  targetStatus: string | null
  sourceFilter: string | null
  action: ActionType
  content: DefinitionContent
  createdByUserId: number
  /** Full condition model (B3). The legacy columns are its projection. */
  conditions: Condition[]
  /** List shape; execution remains single-action until B5. */
  actions: AutomationActionEntry[]
  /** Stable connector identity, never a label. Null = not connection-bound. */
  connectionId: string | null
  /** Stable source identities within that connection. */
  sourceIds: string[]
}

const COLUMNS: string[] = [
  'id',
  'agencyId',
  'name',
  'recipeKey',
  'status',
  'trigger',
  'targetStatus',
  'sourceFilter',
  'action',
  'content',
  'createdByUserId',
  'conditions',
  'actions',
  'connectionId',
  'sourceIds',
]

export function listDefinitionsQuery(agencyId: number) {
  // Soft-deleted rows never reach the UI list.
  return db('automation_definitions')
    .select(COLUMNS)
    .where({ agencyId })
    .whereNot('status', 'deleted')
    .orderBy('createdAt', 'desc')
}

/**
 * Pre-B3 rows may have an empty `conditions` array while their intent lives in
 * the legacy columns. Lifting on read means an automation written before B3
 * opens in the new Builder saying exactly what it always meant.
 */
function normalise(row: AutomationDefinition): AutomationDefinition {
  const conditions =
    row.conditions && row.conditions.length > 0
      ? row.conditions
      : liftFromLegacyColumns({ targetStatus: row.targetStatus, sourceFilter: row.sourceFilter })
  const actions =
    row.actions && row.actions.length > 0
      ? row.actions
      : [{ actionKey: 'email.send', parameters: { subject: row.content?.subject ?? '', body: row.content?.body ?? '' } }]
  return { ...row, conditions, actions, sourceIds: row.sourceIds ?? [] }
}

export async function listDefinitions(agencyId: number): Promise<AutomationDefinition[]> {
  return ((await listDefinitionsQuery(agencyId)) as AutomationDefinition[]).map(normalise)
}

export function getDefinitionQuery(agencyId: number, id: number) {
  return db('automation_definitions').select(COLUMNS).where({ agencyId, id }).first()
}

export async function getDefinition(agencyId: number, id: number): Promise<AutomationDefinition | null> {
  const row = (await getDefinitionQuery(agencyId, id)) as AutomationDefinition | undefined
  return row ? normalise(row) : null
}

export function listActiveDefinitionsForTriggerQuery(agencyId: number, trigger: TriggerType) {
  // Shape matches automation_definitions_active_trigger_idx (partial on
  // status='active'): the emission path scans only live definitions.
  return db('automation_definitions').select(COLUMNS).where({ agencyId, trigger, status: 'active' })
}

export async function listActiveDefinitionsForTrigger(agencyId: number, trigger: TriggerType): Promise<AutomationDefinition[]> {
  return (await listActiveDefinitionsForTriggerQuery(agencyId, trigger)) as AutomationDefinition[]
}

export async function hasActiveDefinitionsForTrigger(agencyId: number, trigger: TriggerType): Promise<boolean> {
  const row = await db('automation_definitions').select('id').where({ agencyId, trigger, status: 'active' }).first()
  return Boolean(row)
}

export type WorkerDefinition = AutomationDefinition & { status: DefinitionStatus }

/**
 * Worker-side load by id, WITH status (the worker re-checks activeness at
 * claim time — a definition paused between enqueue and claim skips the job,
 * ADR-011's definition-inert class). The worker defensively re-verifies
 * agencyId against the job row.
 */
export async function getDefinitionForWorker(id: number): Promise<WorkerDefinition | null> {
  const row = await db('automation_definitions')
    .select([...COLUMNS])
    .where({ id })
    .first()
  return (row as WorkerDefinition | undefined) ?? null
}

export async function createDefinition(input: {
  agencyId: number
  name: string
  recipeKey: string | null
  trigger: TriggerType
  targetStatus: string | null
  sourceFilter: string | null
  content: Omit<DefinitionContent, 'schemaVersion'>
  createdByUserId: number
  conditions?: Condition[]
  connectionId?: string | null
  sourceIds?: string[]
}): Promise<AutomationDefinition> {
  const content: DefinitionContent = { ...input.content, schemaVersion: CONTENT_SCHEMA_VERSION }
  const conditions = input.conditions ?? []
  // The engine still reads the legacy columns; the Builder no longer knows they exist.
  const legacy = projectToLegacyColumns(conditions)
  const [row] = await db('automation_definitions')
    .insert({
      agencyId: input.agencyId,
      name: input.name,
      recipeKey: input.recipeKey,
      status: 'draft',
      trigger: input.trigger,
      targetStatus: legacy.targetStatus,
      sourceFilter: legacy.sourceFilter,
      action: 'send_email',
      content: JSON.stringify(content),
      createdByUserId: input.createdByUserId,
      conditions: JSON.stringify(conditions),
      connectionId: input.connectionId ?? null,
      sourceIds: JSON.stringify(input.sourceIds ?? []),
      actions: JSON.stringify([{ actionKey: 'email.send', parameters: { subject: content.subject, body: content.body } }]),
    })
    .returning(COLUMNS)
  return row as AutomationDefinition
}

export async function updateDefinitionContent(
  agencyId: number,
  id: number,
  patch: {
    name?: string
    conditions?: Condition[]
    connectionId?: string | null
    sourceIds?: string[]
    content?: Omit<DefinitionContent, 'schemaVersion'>
  },
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: db.fn.now() }
  if (patch.name !== undefined) update.name = patch.name
  if (patch.conditions !== undefined) {
    update.conditions = JSON.stringify(patch.conditions)
    // Keep the engine's narrowing columns in lockstep with the conditions.
    const legacy = projectToLegacyColumns(patch.conditions)
    update.targetStatus = legacy.targetStatus
    update.sourceFilter = legacy.sourceFilter
  }
  if (patch.connectionId !== undefined) update.connectionId = patch.connectionId
  if (patch.sourceIds !== undefined) update.sourceIds = JSON.stringify(patch.sourceIds)
  if (patch.content !== undefined) {
    update.content = JSON.stringify({ ...patch.content, schemaVersion: CONTENT_SCHEMA_VERSION })
    update.actions = JSON.stringify([
      { actionKey: 'email.send', parameters: { subject: patch.content.subject, body: patch.content.body } },
    ])
  }
  await db('automation_definitions').where({ agencyId, id }).whereNot('status', 'deleted').update(update)
}

export async function setDefinitionStatus(
  agencyId: number,
  id: number,
  status: Exclude<DefinitionStatus, 'draft'>,
): Promise<void> {
  const stamp: Record<DefinitionStatus, string | null> = {
    draft: null,
    active: 'activatedAt',
    paused: 'pausedAt',
    deleted: 'deletedAt',
  }
  const update: Record<string, unknown> = { status, updatedAt: db.fn.now() }
  const col = stamp[status]
  if (col) update[col] = db.fn.now()
  // 'deleted' is terminal: a deleted definition never changes status again.
  await db('automation_definitions').where({ agencyId, id }).whereNot('status', 'deleted').update(update)
}
