import { db } from '@/config/db'
import type { ActionType, TriggerType } from '@/lib/automations/types'
import type { Timing } from '@/lib/automations/timing'
import type { Condition } from '@/lib/automations/conditions'
import { actionKeyForEngineAction, engineActionForActionKey } from '@/lib/automations/catalog/engineBridge'
import { actionKeyFor, actionsForContent } from '@/lib/automations/actionEntry'

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
  /**
   * The optional CTA action block. Additive jsonb fields inside the existing
   * `content` document — no migration, and rows written before the block
   * existed simply have neither. Both or neither; a half-filled pair renders
   * nothing.
   */
  ctaLabel?: string | null
  ctaUrl?: string | null
  /**
   * `whatsapp.send`'s authored surface — the same additive-jsonb trade the CTA
   * block above makes, for the same reason: no migration, and a row written
   * before the messaging action existed simply has neither field.
   *
   * `templateId` is the chosen ready-made message. `templateBindings` maps a
   * positional slot to a subject field (`{"1":"leadFirstName"}`) and is empty for
   * every template authored in SocialCRM, whose chips already carry their meaning.
   */
  templateId?: number | null
  templateBindings?: Record<string, string> | null
  /**
   * `task.create`'s authored surface — the third additive-jsonb field, for the
   * same reason as the two above: no migration, and a row written before it
   * existed simply has none.
   *
   * A task title is not an email subject: the rep reads it off their own
   * worklist, it has no body beside it, and it resolves only the lead's name.
   * Carrying it in `subject` would have made two meanings share one field and
   * forced every reader to know which action it was looking at.
   */
  title?: string | null
  /**
   * GENERIC answers to an action's own declared parameters, keyed by parameter
   * key — the storage for `enum_agency` and any future catalog-declared control
   * the Builder renders generically.
   *
   * A bag rather than another named field precisely because it is not about one
   * action: the fields above each exist because a specific action authors them,
   * while this one exists because the CATALOG declares them and the Builder
   * renders whatever is declared. A named field per parameter would put this
   * file back in the business of knowing what every action holds.
   *
   * Additive jsonb inside the existing document: no migration, and a row written
   * before it existed simply has none.
   */
  actionParameters?: Record<string, string> | null
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
  /**
   * Last mutation time. Already written by every update path; it is selected so
   * the list can show a `עודכן` column. Read-only addition — nothing writes it
   * here that did not write it before.
   */
  updatedAt?: Date | string
}

const COLUMNS: string[] = [
  'id',
  'agencyId',
  'name',
  'recipeKey',
  'status',
  'trigger',
  'action',
  'content',
  'createdByUserId',
  'conditions',
  'actions',
  'connectionId',
  'sourceIds',
  'updatedAt',
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
 * B6: `conditions` is the sole authority. The legacy `targetStatus` /
 * `sourceFilter` columns are no longer selected, written or read anywhere —
 * the accompanying migration backfilled every row's conditions and moved the
 * status condition onto the live `status` field, which is what the engine's
 * premise check always actually enforced. The columns survive one release so
 * that backfill stays reversible against real data; a follow-up drops them.
 */
function normalise(row: AutomationDefinition): AutomationDefinition {
  const conditions = row.conditions ?? []
  // Rows written before the actions list get one synthesised from the engine
  // column and the content document. The key comes from the permanent bridge,
  // never a literal — the store must not assume which action this is either.
  const synthesizedKey = actionKeyForEngineAction(row.action)
  const actions =
    row.actions && row.actions.length > 0
      ? row.actions
      : synthesizedKey
        ? actionsForContent(synthesizedKey, { subject: row.content?.subject ?? '', body: row.content?.body ?? '' })
        : []
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
  // Normalised like every other read: B5's executor resolution reads the
  // actions list, so the worker must see the same synthesised entry the
  // Builder does for any row that predates it.
  return row ? (normalise(row as AutomationDefinition) as WorkerDefinition) : null
}

export async function createDefinition(input: {
  agencyId: number
  name: string
  recipeKey: string | null
  trigger: TriggerType
  content: Omit<DefinitionContent, 'schemaVersion'>
  createdByUserId: number
  conditions?: Condition[]
  connectionId?: string | null
  sourceIds?: string[]
  /** CATALOG action key. The engine column is derived from it, never assumed. */
  actionKey: string
}): Promise<AutomationDefinition> {
  const content: DefinitionContent = { ...input.content, schemaVersion: CONTENT_SCHEMA_VERSION }
  const conditions = input.conditions ?? []
  const [row] = await db('automation_definitions')
    .insert({
      agencyId: input.agencyId,
      name: input.name,
      recipeKey: input.recipeKey,
      status: 'draft',
      trigger: input.trigger,
      action: engineActionForActionKey(input.actionKey) as ActionType,
      content: JSON.stringify(content),
      createdByUserId: input.createdByUserId,
      conditions: JSON.stringify(conditions),
      connectionId: input.connectionId ?? null,
      sourceIds: JSON.stringify(input.sourceIds ?? []),
      actions: JSON.stringify(actionsForContent(input.actionKey, content)),
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
  if (patch.conditions !== undefined) update.conditions = JSON.stringify(patch.conditions)
  if (patch.connectionId !== undefined) update.connectionId = patch.connectionId
  if (patch.sourceIds !== undefined) update.sourceIds = JSON.stringify(patch.sourceIds)
  if (patch.content !== undefined) {
    update.content = JSON.stringify({ ...patch.content, schemaVersion: CONTENT_SCHEMA_VERSION })
    // The row's own action key is preserved: editing content never changes
    // WHICH action runs, and the store must not decide that it is email.
    const existing = (await db('automation_definitions').select('action', 'actions').where({ agencyId, id }).first()) as
      | Pick<AutomationDefinition, 'action' | 'actions'>
      | undefined
    const actionKey = existing ? actionKeyFor(existing) : null
    if (actionKey) update.actions = JSON.stringify(actionsForContent(actionKey, patch.content))
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
