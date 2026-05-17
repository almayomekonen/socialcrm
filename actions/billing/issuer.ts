'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { validateIssuerValues } from '@/lib/billing/issuer/validation'
import { checkIssuerCompleteness } from '@/lib/billing/issuer/completeness'
import { getIssuer, updateIssuer } from '@/db/billing/issuer'
import type { IssuerData } from '@/lib/billing/issuer/fields'

export type IssuerActionResult = { success: true } | { error: true; reason: IssuerErrorReason }

export type IssuerErrorReason = 'no_permission' | 'invalid_input' | 'failed'

export async function updateIssuerIdentityAction(values: Partial<IssuerData>): Promise<IssuerActionResult> {
  const user = await requireUser()

  if (!isAdmin(user.role)) return { error: true, reason: 'no_permission' }

  const validation = validateIssuerValues(values)
  if (!validation.ok) return { error: true, reason: 'invalid_input' }

  try {
    await updateIssuer(user.agencyId, values)
    revalidatePath('/settings/update_agency')
    return { success: true }
  } catch (err) {
    logActionError('billing.action.update_issuer', err, { agencyId: user.agencyId })
    return { error: true, reason: 'failed' }
  }
}

export type GetIssuerActionResult = { issuer: IssuerData } | { error: true; reason: 'failed' }

export async function getIssuerAction(): Promise<GetIssuerActionResult> {
  try {
    const user = await requireUser()
    const issuer = await getIssuer(user.agencyId)
    if (!issuer) return { error: true, reason: 'failed' }
    return { issuer }
  } catch (err) {
    logActionError('billing.action.get_issuer', err, {})
    return { error: true, reason: 'failed' }
  }
}

export type IssuerCompletenessActionResult =
  | { complete: true }
  | { complete: false; missing: ReadonlyArray<string>; canEdit: boolean }
  | { error: true; reason: 'failed' }

export async function getIssuerCompletenessAction(): Promise<IssuerCompletenessActionResult> {
  try {
    const user = await requireUser()
    const issuer = await getIssuer(user.agencyId)
    if (!issuer) return { error: true, reason: 'failed' }

    const result = checkIssuerCompleteness(issuer)
    if ('missing' in result) {
      return {
        complete: false,
        missing: result.missing,
        canEdit: isAdmin(user.role),
      }
    }
    return { complete: true }
  } catch (err) {
    logActionError('billing.action.get_issuer_completeness', err, {})
    return { error: true, reason: 'failed' }
  }
}

function logActionError(channel: string, err: unknown, extra: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err)
  const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
  console.error(channel, JSON.stringify({ ...extra, message: truncated }))
}
