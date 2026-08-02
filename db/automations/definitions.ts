import { db } from '@/config/db'
import type { ActionType, TriggerType } from '@/lib/automations/types'
import type { Timing } from '@/lib/automations/timing'

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
]

export function listDefinitionsQuery(agencyId: number) {
  // Soft-deleted rows never reach the UI list.
  return db('automation_definitions')
    .select(COLUMNS)
    .where({ agencyId })
    .whereNot('status', 'deleted')
    .orderBy('createdAt', 'desc')
}

export async function listDefinitions(agencyId: number): Promise<AutomationDefinition[]> {
  return (await listDefinitionsQuery(agencyId)) as AutomationDefinition[]
}

export function getDefinitionQuery(agencyId: number, id: number) {
  return db('automation_definitions').select(COLUMNS).where({ agencyId, id }).first()
}

export async function getDefinition(agencyId: number, id: number): Promise<AutomationDefinition | null> {
  return ((await getDefinitionQuery(agencyId, id)) as AutomationDefinition | undefined) ?? null
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

export async function createDefinition(input: {
  agencyId: number
  name: string
  recipeKey: string | null
  trigger: TriggerType
  targetStatus: string | null
  sourceFilter: string | null
  content: Omit<DefinitionContent, 'schemaVersion'>
  createdByUserId: number
}): Promise<AutomationDefinition> {
  const content: DefinitionContent = { ...input.content, schemaVersion: CONTENT_SCHEMA_VERSION }
  const [row] = await db('automation_definitions')
    .insert({
      agencyId: input.agencyId,
      name: input.name,
      recipeKey: input.recipeKey,
      status: 'draft',
      trigger: input.trigger,
      targetStatus: input.targetStatus,
      sourceFilter: input.sourceFilter,
      action: 'send_email',
      content: JSON.stringify(content),
      createdByUserId: input.createdByUserId,
    })
    .returning(COLUMNS)
  return row as AutomationDefinition
}

export async function updateDefinitionContent(
  agencyId: number,
  id: number,
  patch: {
    name?: string
    targetStatus?: string | null
    sourceFilter?: string | null
    content?: Omit<DefinitionContent, 'schemaVersion'>
  },
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: db.fn.now() }
  if (patch.name !== undefined) update.name = patch.name
  if (patch.targetStatus !== undefined) update.targetStatus = patch.targetStatus
  if (patch.sourceFilter !== undefined) update.sourceFilter = patch.sourceFilter
  if (patch.content !== undefined) update.content = JSON.stringify({ ...patch.content, schemaVersion: CONTENT_SCHEMA_VERSION })
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
