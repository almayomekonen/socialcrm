'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { createDefinition, setDefinitionStatus } from '@/db/automations/definitions'
import { installedAutomationIds, listInstalls, recordInstall } from '@/db/automations/templateInstalls'
import { getTemplate } from '@/lib/automations/templates/registry'
import { prepare, validateTemplate, type TemplateValues } from '@/lib/automations/templates/install'
import { engineTriggerForEventKey } from '@/lib/automations/catalog/engineBridge'
import type { TriggerType } from '@/lib/automations/types'

/**
 * Installing a template is CREATING ORDINARY AUTOMATIONS.
 *
 * It goes through the same `createDefinition` the Builder uses, produces the
 * same rows, and records only that it happened. From the next millisecond the
 * customer owns them: editing, pausing or deleting one is an ordinary Builder
 * action and the marketplace has no say in it.
 *
 * There is deliberately NO code path from a template to an existing
 * automation. That is what makes "an update never overwrites a customer edit"
 * a structural property rather than a promise.
 */

const PATH = '/settings/automation-templates'

export type InstallResult = { ok: true; created: number } | { ok: false; reason: string }

async function guard() {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return null
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return null
  return user
}

export async function installTemplate(templateKey: string, values: TemplateValues = {}): Promise<InstallResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }

  const template = getTemplate(templateKey)
  if (!template) return { ok: false, reason: 'template_unknown' }
  // Validated against the LIVE catalog at install time too, not only in CI: a
  // template naming an event that was later deprecated must refuse rather than
  // create an automation that can never fire.
  if (validateTemplate(template).length > 0) return { ok: false, reason: 'template_invalid' }

  const prepared = prepare(template, values)
  for (const p of prepared) {
    const required = template.variables.filter((v) => v.validation?.required)
    for (const variable of required) {
      if (!(values[variable.key] ?? variable.default ?? '').trim()) return { ok: false, reason: 'variable_required' }
    }
    if (!engineTriggerForEventKey(p.eventKey)) return { ok: false, reason: 'template_invalid' }
  }

  let created = 0
  for (const p of prepared) {
    const definition = await createDefinition({
      agencyId: user.agencyId,
      name: p.name,
      // The marketplace's own provenance lives in its own table; `recipeKey`
      // belongs to the Builder's starter recipes and is left alone.
      recipeKey: null,
      trigger: engineTriggerForEventKey(p.eventKey) as TriggerType,
      conditions: [...p.conditions],
      connectionId: null,
      sourceIds: [],
      actionKey: p.actionKey,
      content: {
        subject: p.parameters.subject ?? p.parameters.title ?? '',
        body: p.parameters.body ?? p.parameters.title ?? '',
        timing: p.timing,
      },
      createdByUserId: user.id,
    })
    await recordInstall({
      agencyId: user.agencyId,
      templateKey: template.key,
      templateVersion: template.version,
      automationId: definition.id,
      installedByUserId: user.id,
    })
    created++
  }

  revalidatePath(PATH)
  revalidatePath('/settings/automations')
  return { ok: true, created }
}

/**
 * Uninstall removes the automations this template created — as an ordinary
 * soft delete, the same one the Builder performs. It is never a hard delete:
 * the activity log and the send-once claims reference definitions forever.
 */
export async function uninstallTemplate(templateKey: string): Promise<InstallResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }

  const ids = await installedAutomationIds(user.agencyId, templateKey)
  for (const id of ids) await setDefinitionStatus(user.agencyId, id, 'deleted')

  revalidatePath(PATH)
  revalidatePath('/settings/automations')
  return { ok: true, created: ids.length }
}

/** What this agency has installed, for the marketplace's own rendering. */
export async function listTemplateInstalls() {
  const user = await guard()
  if (!user) return []
  return listInstalls(user.agencyId)
}
