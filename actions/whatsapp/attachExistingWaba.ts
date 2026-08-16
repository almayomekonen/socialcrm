'use server'

import { requireProductAccess, AuthError, ProductAccessError } from '@/lib/requireUser'
import {
  attachExistingWabaForUser,
  type AttachExistingWabaInput,
  type AttachExistingWabaResult,
} from '@/lib/whatsapp/attachExistingWaba'

/**
 * INTERNAL TEST-ONLY. No customer UI. Session agency only. Agency 103 ADMIN.
 * Token is never logged. Caller must not persist the token in git or chat.
 */
export async function attachExistingWaba(input: AttachExistingWabaInput): Promise<AttachExistingWabaResult> {
  try {
    const user = await requireProductAccess()
    return attachExistingWabaForUser(
      { id: user.id, agencyId: user.agencyId, role: String(user.role) },
      input,
    )
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, reason: 'unauthorized' }
    if (err instanceof ProductAccessError) return { ok: false, reason: 'forbidden' }
    return { ok: false, reason: 'forbidden' }
  }
}
