'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import {
  createDefinition,
  getDefinition,
  setDefinitionStatus,
  updateDefinitionContent,
  type DefinitionContent,
} from '@/db/automations/definitions'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { isValidTiming, type Timing } from '@/lib/automations/timing'
import { unknownTokensFor } from '@/lib/automations/variables'
import { resolvableFieldsFor } from '@/lib/automations/executors/registry'
import type { TriggerType } from '@/lib/automations/types'
import { getEvent, listActionsForEvent } from '@/lib/automations/catalog/registry'
import { checkParameter } from '@/lib/automations/catalog/parameterRules'
import { sourceIdsFrom } from '@/lib/automations/binding'
import { actionKeyFor } from '@/lib/automations/actionEntry'
import { engineTriggerForEventKey } from '@/lib/automations/catalog/engineBridge'
import { validateConditions, type Condition } from '@/lib/automations/conditions'

/**
 * Customer Automation Engine — admin management actions.
 *
 * Every action is admin-only and agency-scoped; a definition id from the wire
 * is always re-read under the caller's agencyId before it is touched. Reasons
 * are machine codes translated by the client (the updateAutoResponseSettings
 * convention).
 */

const PATH = '/settings/automations'

export type ManageResult = { ok: true; id?: number } | { ok: false; reason: string }

export type AutomationInput = {
  name: string
  recipeKey: string | null
  /** A CATALOG event key. The Builder no longer speaks the engine's vocabulary. */
  eventKey: string
  conditions: Condition[]
  connectionId?: string | null
  parameters?: Record<string, string>
  subject: string
  body: string
  /** The optional CTA action block — both halves, or neither. */
  ctaLabel?: string | null
  ctaUrl?: string | null
  timing: Timing
}

async function requireAutomationsAdmin() {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { user: null, reason: 'forbidden' as const }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { user: null, reason: 'not_available' as const }
  return { user, reason: null }
}

function validate(input: AutomationInput): string | null {
  if (!input.name?.trim()) return 'name_required'
  if (!input.subject?.trim()) return 'subject_required'
  if (!input.body?.trim()) return 'body_required'
  // Unknown event ⇒ inert, never guessed (Law 3).
  const event = getEvent(input.eventKey)
  if (!event || !engineTriggerForEventKey(input.eventKey)) return 'trigger_invalid'
  const conditionIssue = validateConditions(event, input.conditions ?? [])
  if (conditionIssue) return conditionIssue
  if (!isValidTiming(input.timing)) return 'timing_invalid'
  /**
   * B6b: content is validated against what THIS action's executor can
   * substitute, not against a global email vocabulary. An action with no
   * executor resolves nothing, so its content is rejected rather than passed
   * by a set that never applied to it.
   */
  const actionKey = actionKeyForInput(input)
  if (!actionKey) return 'action_invalid'
  const resolvable = resolvableFieldsFor(actionKey)
  if (unknownTokensFor(resolvable, input.subject).length || unknownTokensFor(resolvable, input.body).length) {
    return 'unknown_variable'
  }
  const ctaIssue = validateCta(input, actionKey, resolvable)
  if (ctaIssue) return ctaIssue
  return null
}

/**
 * The CTA is ONE optional block, so it is validated as one: present means both
 * halves, absent means neither. A label with no destination is the failure mode
 * this prevents.
 */
function validateCta(input: AutomationInput, actionKey: string, resolvable: readonly string[]): string | null {
  const label = input.ctaLabel?.trim() ?? ''
  const url = input.ctaUrl?.trim() ?? ''
  if (!label && !url) return null
  if (!label || !url) return 'cta_incomplete'
  // Bounds and URL shape come from the catalog declaration, so there is one
  // source of truth for what the Builder shows and what the server enforces.
  if (checkParameter(actionKey, 'ctaLabel', label)) return 'cta_label_invalid'
  if (checkParameter(actionKey, 'ctaUrl', url)) return 'cta_url_invalid'
  if (unknownTokensFor(resolvable, label).length) return 'unknown_variable'
  return null
}

function toContent(input: AutomationInput): Omit<DefinitionContent, 'schemaVersion'> {
  const label = input.ctaLabel?.trim() ?? ''
  const url = input.ctaUrl?.trim() ?? ''
  const hasCta = Boolean(label && url)
  return {
    subject: input.subject.trim(),
    body: input.body.trim(),
    timing: input.timing,
    ctaLabel: hasCta ? label : null,
    ctaUrl: hasCta ? url : null,
  }
}

/**
 * Which action a new automation runs: the first the chosen event can offer.
 * Derived from the catalog's `requires` × the event's `fields`, never named —
 * so the day a second action is registered, this picks it up as data.
 */
function actionKeyForInput(input: AutomationInput): string | null {
  const event = getEvent(input.eventKey)
  return event ? (listActionsForEvent(event)[0]?.key ?? null) : null
}

export async function createAutomation(input: AutomationInput): Promise<ManageResult> {
  const { user, reason } = await requireAutomationsAdmin()
  if (!user) return { ok: false, reason }

  const invalid = validate(input)
  if (invalid) return { ok: false, reason: invalid }

  const actionKey = actionKeyForInput(input)
  if (!actionKey) return { ok: false, reason: 'action_invalid' }

  const created = await createDefinition({
    agencyId: user.agencyId,
    name: input.name.trim(),
    recipeKey: input.recipeKey,
    trigger: engineTriggerForEventKey(input.eventKey) as TriggerType,
    conditions: input.conditions ?? [],
    connectionId: input.connectionId ?? null,
    sourceIds: sourceIdsFrom(getEvent(input.eventKey), input.parameters),
    actionKey,
    content: toContent(input),
    createdByUserId: user.id,
  })
  revalidatePath(PATH)
  return { ok: true, id: created.id }
}

export async function updateAutomation(id: number, input: AutomationInput): Promise<ManageResult> {
  const { user, reason } = await requireAutomationsAdmin()
  if (!user) return { ok: false, reason }

  const invalid = validate(input)
  if (invalid) return { ok: false, reason: invalid }

  const existing = await getDefinition(user.agencyId, id)
  if (!existing || existing.status === 'deleted') return { ok: false, reason: 'not_found' }

  await updateDefinitionContent(user.agencyId, id, {
    name: input.name.trim(),
    conditions: input.conditions ?? [],
    connectionId: input.connectionId ?? null,
    sourceIds: sourceIdsFrom(getEvent(input.eventKey), input.parameters),
    content: toContent(input),
  })
  revalidatePath(PATH)
  return { ok: true, id }
}

/** activate | pause | delete — 'deleted' is terminal (soft delete, ADR-008). */
export async function setAutomationStatus(id: number, status: 'active' | 'paused' | 'deleted'): Promise<ManageResult> {
  const { user, reason } = await requireAutomationsAdmin()
  if (!user) return { ok: false, reason }

  const existing = await getDefinition(user.agencyId, id)
  if (!existing || existing.status === 'deleted') return { ok: false, reason: 'not_found' }

  await setDefinitionStatus(user.agencyId, id, status)
  revalidatePath(PATH)
  return { ok: true, id }
}

/**
 * Duplicating creates a DRAFT with a fresh id — and therefore a fresh
 * once-ever allowance (ADR-005). This is how users build sequences in V1
 * without a sequence builder existing.
 */
export async function duplicateAutomation(id: number): Promise<ManageResult> {
  const { user, reason } = await requireAutomationsAdmin()
  if (!user) return { ok: false, reason }

  const existing = await getDefinition(user.agencyId, id)
  if (!existing || existing.status === 'deleted') return { ok: false, reason: 'not_found' }

  const copy = await createDefinition({
    agencyId: user.agencyId,
    name: `${existing.name} (עותק)`,
    recipeKey: existing.recipeKey,
    trigger: existing.trigger,
    conditions: existing.conditions,
    connectionId: existing.connectionId,
    sourceIds: existing.sourceIds,
    // A copy runs the same action as its original — read, never assumed.
    actionKey: actionKeyFor(existing) as string,
    content: { subject: existing.content.subject, body: existing.content.body, timing: existing.content.timing },
    createdByUserId: user.id,
  })
  revalidatePath(PATH)
  return { ok: true, id: copy.id }
}
