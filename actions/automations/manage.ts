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
import type { TriggerType } from '@/lib/automations/types'
import { getEvent } from '@/lib/automations/catalog/registry'
import { loadTemplateForSend } from '@/db/whatsappTemplates'
import { unmappedSlots } from '@/lib/automations/whatsapp/templateParams'
import { sourceIdsFrom } from '@/lib/automations/binding'
import { actionKeyFor, authoredContentOf } from '@/lib/automations/actionEntry'
import { engineTriggerForEventKey } from '@/lib/automations/catalog/engineBridge'
import {
  actionKeyForInput,
  isTemplateAction,
  toContent,
  validate,
  type AutomationInput,
} from '@/lib/automations/definitionInput'

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

async function requireAutomationsAdmin() {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { user: null, reason: 'forbidden' as const }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { user: null, reason: 'not_available' as const }
  return { user, reason: null }
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
    /**
     * The WHOLE authored document, minus the version stamp `createDefinition`
     * re-applies. Listing fields by hand silently dropped every one added after
     * the list was written — the CTA block, the WhatsApp template and its slot
     * bindings — so duplicating a messaging automation produced a copy that
     * could never send, and duplicating an email with a button lost the button.
     * Spreading means a field added to `DefinitionContent` tomorrow is copied
     * without anyone remembering this line exists.
     */
    content: authoredContentOf(existing.content),
    createdByUserId: user.id,
  })
  revalidatePath(PATH)
  return { ok: true, id: copy.id }
}
