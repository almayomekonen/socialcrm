'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { isPackKind } from '@/lib/credits/config'
import { purchaseCreditPack, type PurchaseResult } from '@/lib/credits/purchase'

/**
 * Buy ONE credit pack with the agency's saved card. Called only from the
 * explicit confirmation in the billing centre; the request key is generated
 * there once per confirmation, so a double click or a resubmitted form charges
 * once. Agency-wide like the subscription itself, so admins only.
 */
export async function buyCreditPack(input: { kind: string; requestKey: string }): Promise<PurchaseResult | { state: 'refused'; reason: 'unauthorized' }> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { state: 'refused', reason: 'unauthorized' }
    throw err
  }
  if (!isAdmin(user.role)) return { state: 'refused', reason: 'unauthorized' }
  if (!isPackKind(input?.kind)) return { state: 'refused', reason: 'invalid_request' }

  const result = await purchaseCreditPack({ agencyId: user.agencyId, kind: input.kind, requestKey: String(input.requestKey ?? '') })
  revalidatePath('/settings/update_payment')
  return result
}
