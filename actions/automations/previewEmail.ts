'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { catalog, getAction } from '@/lib/automations/catalog/registry'
import { executorFor, resolvableFieldsFor } from '@/lib/automations/executors/registry'
import { unknownTokensFor } from '@/lib/automations/variables'
import type { PreviewResult } from '@/lib/automations/executors/types'

/**
 * "כך זה ייראה" — the Builder preview, rendered by the ACTION.
 *
 * Before this, the Builder drew its own approximation: the body as one
 * app-styled paragraph, no footer, no unsubscribe, and `businessName: null` so
 * it showed the placeholder "העסק" instead of the customer's own name. The
 * customer could not see what they were sending, which is how a signature with
 * three run-together business names reached real inboxes.
 *
 * Mirrors sendTest deliberately: same authorisation, same generic dispatch, same
 * ignorance of what channel the action speaks. It renders only — no transport,
 * no claim, no activity row — so it is safe to call while typing.
 */

export async function previewAutomationEmail(input: {
  subject: string
  body: string
  ctaLabel?: string | null
  ctaUrl?: string | null
  actionKey?: string
}): Promise<PreviewResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }

  // The single previewable action V1 offers, FOUND rather than named.
  const actionKey = input.actionKey ?? catalog.actions.find((a) => a.preview === 'email')?.key ?? null
  const action = actionKey ? getAction(actionKey) : null
  const executor = actionKey ? executorFor(actionKey) : null
  if (!action || !executor?.preview) return { ok: false, reason: 'action_invalid' }

  // An unknown token would render as a raw `{{...}}` in the preview, teaching
  // the customer that it is acceptable. Rejected here as it is on save.
  const resolvable = resolvableFieldsFor(actionKey as string)
  const authored = [input.subject ?? '', input.body ?? '', input.ctaLabel ?? '']
  if (authored.some((content) => unknownTokensFor(resolvable, content).length > 0)) {
    return { ok: false, reason: 'unknown_variable' }
  }

  return executor.preview(
    {
      subject: input.subject ?? '',
      body: input.body ?? '',
      ctaLabel: input.ctaLabel ?? '',
      ctaUrl: input.ctaUrl ?? '',
    },
    { agencyId: user.agencyId, toName: user.name ?? null },
    executor.defaultDeps(),
  )
}
