'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { loadTemplateForSend } from '@/db/whatsappTemplates'
import { executorFor } from '@/lib/automations/executors/registry'
import { catalog } from '@/lib/automations/catalog/registry'
import { templateSlots, type TemplateSlot } from '@/lib/automations/whatsapp/templateParams'
import type { PreviewResult } from '@/lib/automations/executors/types'

/**
 * The Builder's two reads for a WhatsApp automation: what the chosen template
 * needs filled in, and what it will look like.
 *
 * Both mirror `previewEmail.ts` deliberately — same authorisation, same agency
 * scoping, same read-only guarantee (no transport, no claim, no activity row), so
 * they are safe to call while the customer is still choosing.
 */

/**
 * The message-previewing action, FOUND rather than named — the same technique
 * `previewEmail.ts` uses for its own shape. Naming the action here would put the
 * channel back into a generic surface.
 */
const messageActionKey = (): string | null => catalog.actions.find((a) => a.preview === 'message')?.key ?? null

export type TemplateSlotsResult =
  | { ok: true; slots: TemplateSlot[]; approved: boolean; bodyText: string }
  | { ok: false; reason: string }

/**
 * The slots a template exposes, and whether it can be sent at all.
 *
 * A template authored in SocialCRM returns slots that already name their field —
 * the Builder then has nothing to ask. A Meta-synced template returns slots with
 * `field: null`, which is the Builder's cue to ask, and the reason it must never
 * guess from the slot's index.
 */
export async function listTemplateSlots(templateIdRaw: number | string): Promise<TemplateSlotsResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }

  const templateId = Number(templateIdRaw)
  if (!Number.isInteger(templateId) || templateId <= 0) return { ok: false, reason: 'template_required' }

  // Agency-scoped: a template id from the wire is always re-read under the
  // caller's agency before anything is returned about it.
  const template = await loadTemplateForSend(templateId, user.agencyId)
  if (!template) return { ok: false, reason: 'template_not_found' }

  return {
    ok: true,
    slots: templateSlots(template),
    approved: template.status === 'approved',
    bodyText: template.bodyText,
  }
}

/**
 * "כך זה ייראה" for a message action — rendered by the EXECUTOR, so the preview
 * and the send cannot disagree. Same contract as the email preview; only the
 * shape of the answer differs.
 */
export async function previewAutomationMessage(input: {
  templateId: number | string | null
  templateBindings?: Record<string, string> | null
}): Promise<PreviewResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }

  const actionKey = messageActionKey()
  const executor = actionKey ? executorFor(actionKey) : null
  if (!executor?.preview) return { ok: false, reason: 'action_invalid' }

  return executor.preview(
    { templateId: input.templateId, templateBindings: input.templateBindings ?? {} },
    { agencyId: user.agencyId, toName: user.name ?? null },
    executor.defaultDeps(),
  )
}
