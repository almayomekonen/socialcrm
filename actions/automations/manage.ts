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
import { getAction, getEvent, listActionsForEvent } from '@/lib/automations/catalog/registry'
import { loadTemplateForSend } from '@/db/whatsappTemplates'
import { unmappedSlots } from '@/lib/automations/whatsapp/templateParams'
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
  /**
   * WHICH action to run — an explicit CATALOG key now that more than one action
   * can serve the same event.
   *
   * Optional, and validated against what the chosen event can actually offer. Left
   * absent it falls back to the first offerable action, which is what every caller
   * did implicitly when `email.send` was the only choice — so existing callers and
   * stored recipes keep their behaviour exactly.
   */
  actionKey?: string | null
  subject: string
  body: string
  /** The optional CTA action block — both halves, or neither. */
  ctaLabel?: string | null
  ctaUrl?: string | null
  /** `whatsapp.send`'s authored surface: the chosen template and its slot mapping. */
  templateId?: number | null
  templateBindings?: Record<string, string> | null
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
  // Unknown event ⇒ inert, never guessed (Law 3).
  const event = getEvent(input.eventKey)
  if (!event || !engineTriggerForEventKey(input.eventKey)) return 'trigger_invalid'
  const conditionIssue = validateConditions(event, input.conditions ?? [])
  if (conditionIssue) return conditionIssue
  if (!isValidTiming(input.timing)) return 'timing_invalid'

  /**
   * The action is resolved BEFORE its content is judged, because what counts as
   * valid content is the action's own business. Subject and body are `email.send`'s
   * required parameters, not the engine's — demanding them from a message action
   * would reject a perfectly configured WhatsApp automation for lacking fields it
   * does not have.
   */
  const actionKey = actionKeyForInput(input)
  if (!actionKey) return 'action_invalid'

  if (isTemplateAction(actionKey)) {
    // The content IS the approved template; there is nothing authored to lint.
    // Its existence, approval and slot mapping need a read, so they are checked
    // in `validateTemplateChoice` rather than here.
    if (!input.templateId) return 'template_required'
    return null
  }

  if (!input.subject?.trim()) return 'subject_required'
  if (!input.body?.trim()) return 'body_required'
  /**
   * B6b: content is validated against what THIS action's executor can
   * substitute, not against a global email vocabulary. An action with no
   * executor resolves nothing, so its content is rejected rather than passed
   * by a set that never applied to it.
   */
  const resolvable = resolvableFieldsFor(actionKey)
  if (unknownTokensFor(resolvable, input.subject).length || unknownTokensFor(resolvable, input.body).length) {
    return 'unknown_variable'
  }
  const ctaIssue = validateCta(input, actionKey, resolvable)
  if (ctaIssue) return ctaIssue
  return null
}

/**
 * The template must exist, belong to THIS agency, be approved, and have every
 * slot mapped — checked at SAVE time so the customer cannot store an automation
 * that could never send.
 *
 * The executor re-checks approval at send time regardless, because Meta can
 * withdraw it later. This is not that check duplicated; it is the difference
 * between "cannot be saved" and "was saved and silently never fired".
 */
async function validateTemplateChoice(agencyId: number, input: AutomationInput, actionKey: string): Promise<string | null> {
  if (!isTemplateAction(actionKey)) return null
  const template = await loadTemplateForSend(Number(input.templateId), agencyId)
  if (!template) return 'template_not_found'
  if (template.status !== 'approved') return 'template_not_approved'
  if (unmappedSlots(template, input.templateBindings ?? {}).length > 0) return 'template_unmapped'
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
    subject: (input.subject ?? '').trim(),
    body: (input.body ?? '').trim(),
    timing: input.timing,
    ctaLabel: hasCta ? label : null,
    ctaUrl: hasCta ? url : null,
    // Carried only when chosen, so an email automation's content document is
    // unchanged from what it was before the messaging action existed.
    templateId: input.templateId ?? null,
    templateBindings: input.templateBindings ?? null,
  }
}

/**
 * Which action this automation runs.
 *
 * The customer's explicit choice when they made one, and the first offerable
 * action when they did not. Either way the answer must be an action the EVENT can
 * offer — a key the caller invented, or one whose recipient this event cannot
 * supply, is refused rather than trusted.
 */
function actionKeyForInput(input: AutomationInput): string | null {
  const event = getEvent(input.eventKey)
  if (!event) return null
  const offerable = listActionsForEvent(event)
  const chosen = input.actionKey?.trim()
  if (chosen) return offerable.some((a) => a.key === chosen) ? chosen : null
  return offerable[0]?.key ?? null
}

/** Is this action's content authored as a message template rather than as text? */
const isTemplateAction = (actionKey: string): boolean =>
  (getAction(actionKey)?.parameters ?? []).some((p) => p.key === 'templateId')

export async function createAutomation(input: AutomationInput): Promise<ManageResult> {
  const { user, reason } = await requireAutomationsAdmin()
  if (!user) return { ok: false, reason }

  const invalid = validate(input)
  if (invalid) return { ok: false, reason: invalid }

  const actionKey = actionKeyForInput(input)
  if (!actionKey) return { ok: false, reason: 'action_invalid' }
  const templateIssue = await validateTemplateChoice(user.agencyId, input, actionKey)
  if (templateIssue) return { ok: false, reason: templateIssue }

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

  /**
   * Validated against the STORED action key, not the input's: an edit never
   * changes which action runs (`updateDefinitionContent` preserves it), so
   * judging the new content by a different action than the one that will execute
   * it would validate something that never happens.
   */
  const templateIssue = await validateTemplateChoice(user.agencyId, input, actionKeyFor(existing) ?? '')
  if (templateIssue) return { ok: false, reason: templateIssue }

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
