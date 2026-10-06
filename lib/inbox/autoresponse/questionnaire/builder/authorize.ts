/**
 * Who may use the Questionnaire Builder, and on which agency.
 *
 * The agency is ALWAYS the signed-in user's own (`requireProductAccess` derives
 * it from the session). No Builder action accepts an agency id from the
 * browser. Admin roles only (the same rule as the auto-response settings), and
 * only agencies in the Builder rollout.
 */
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { canUseQuestionnaireBuilder } from '@/lib/flags/questionnaireBuilderFlags'
import type { BuilderContext } from './service'

export async function authorizeBuilder(): Promise<BuilderContext | null> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return null
  if (!canUseQuestionnaireBuilder(user.agencyId)) return null
  return { agencyId: user.agencyId, userId: Number(user.id) }
}

/** A positive integer from the browser, or null. */
export function idFrom(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
