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
import { unknownTokens } from '@/lib/automations/variables'
import { TRIGGER_TYPES, type TriggerType } from '@/lib/automations/types'

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
  trigger: TriggerType
  targetStatus: string | null
  sourceFilter: string | null
  subject: string
  body: string
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
  if (!TRIGGER_TYPES.includes(input.trigger)) return 'trigger_invalid'
  if (input.trigger === 'status_changed' && !input.targetStatus) return 'status_required'
  if (!isValidTiming(input.timing)) return 'timing_invalid'
  // Content may only reference the closed variable set (spec §7).
  if (unknownTokens(input.subject).length || unknownTokens(input.body).length) return 'unknown_variable'
  return null
}

function toContent(input: AutomationInput): Omit<DefinitionContent, 'schemaVersion'> {
  return { subject: input.subject.trim(), body: input.body.trim(), timing: input.timing }
}

export async function createAutomation(input: AutomationInput): Promise<ManageResult> {
  const { user, reason } = await requireAutomationsAdmin()
  if (!user) return { ok: false, reason }

  const invalid = validate(input)
  if (invalid) return { ok: false, reason: invalid }

  const created = await createDefinition({
    agencyId: user.agencyId,
    name: input.name.trim(),
    recipeKey: input.recipeKey,
    trigger: input.trigger,
    targetStatus: input.trigger === 'status_changed' ? input.targetStatus : null,
    sourceFilter: input.trigger === 'lead_created' ? input.sourceFilter : null,
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
    targetStatus: input.trigger === 'status_changed' ? input.targetStatus : null,
    sourceFilter: input.trigger === 'lead_created' ? input.sourceFilter : null,
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
    targetStatus: existing.targetStatus,
    sourceFilter: existing.sourceFilter,
    content: { subject: existing.content.subject, body: existing.content.body, timing: existing.content.timing },
    createdByUserId: user.id,
  })
  revalidatePath(PATH)
  return { ok: true, id: copy.id }
}
