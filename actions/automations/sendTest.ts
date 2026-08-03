'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { catalog, getAction } from '@/lib/automations/catalog/registry'
import { executorFor, resolvableFieldsFor } from '@/lib/automations/executors/registry'
import { unknownTokensFor } from '@/lib/automations/variables'

/**
 * "שלח אליי בדיקה" — now GENERIC (frozen §3.9).
 *
 * B6b removed this file's email knowledge entirely: it no longer resolves a
 * sender identity, renders an email, or reaches a transport. It authorises the
 * caller, checks that the action is testable, and asks the ACTION's executor
 * to produce the sample. A future channel gets the affordance for free.
 *
 * It is still not a customer send: no claim, no activity row, no cap, and only
 * to the caller's own address — so it runs regardless of AUTOMATIONS_SEND_MODE
 * without making live sending reachable for leads.
 */

export type SendTestResult = { ok: true } | { ok: false; reason: string }

export async function sendTestEmail(input: { subject: string; body: string; actionKey?: string }): Promise<SendTestResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }
  if (!user.email) return { ok: false, reason: 'no_recipient' }
  if (!input.subject?.trim() || !input.body?.trim()) return { ok: false, reason: 'content_required' }

  // V1's Builder renders exactly one action, so an absent key means that one.
  // Resolved through the catalog registry, never named here.
  // The single testable action V1 offers, FOUND rather than named.
  const actionKey = input.actionKey ?? catalog.actions.find((a) => a.testable)?.key ?? null
  const action = actionKey ? getAction(actionKey) : null
  const executor = actionKey ? executorFor(actionKey) : null
  if (!action || !executor) return { ok: false, reason: 'action_invalid' }
  // `testable` is the catalog's decision and `test` is the executor's. Both
  // must be present — a declared-but-unimplemented test is never offered.
  if (!action.testable || !executor.test) return { ok: false, reason: 'not_testable' }

  // Validation uses the ACTION's vocabulary, not a global email set.
  const resolvable = resolvableFieldsFor(actionKey as string)
  if (unknownTokensFor(resolvable, input.subject).length || unknownTokensFor(resolvable, input.body).length) {
    return { ok: false, reason: 'unknown_variable' }
  }

  return executor.test(
    { subject: input.subject, body: input.body },
    { agencyId: user.agencyId, toName: user.name ?? null, address: user.email },
    executor.defaultDeps(),
  )
}
