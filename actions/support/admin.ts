'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import {
  appendSupportMessageForAdmin,
  setSupportRequestStatusForAdmin,
} from '@/db/support/admin'
import { validateReplyBody } from '@/lib/support/validation'
import { isSupportStatus, type SupportStatus } from '@/lib/support/vocabulary'

/**
 * THE PLATFORM-OWNER SESSION BOUNDARY.
 *
 * Authorization here is `isPlatformOwner(email)` — an allowlist deliberately
 * separate from the workspace role system, because an agency "admin" is an admin
 * of THEIR OWN workspace and must never gain cross-tenant reach. A workspace
 * ADMIN calling these gets the same refusal as anyone else.
 *
 * The page gate is NOT sufficient: a Server Action is an independently
 * addressable endpoint, so every function re-checks ownership itself.
 */

export type AdminSupportActionResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid_body' | 'invalid_status' }

async function requirePlatformOwner(): Promise<{ id: number } | null> {
  const user = await getUser()
  if (!user || !isPlatformOwner(user.email)) return null
  return { id: user.id }
}

export async function replyAsSupportAction(
  requestId: number,
  body: string,
): Promise<AdminSupportActionResult> {
  const owner = await requirePlatformOwner()
  if (!owner) return { ok: false, reason: 'forbidden' }

  const validated = validateReplyBody(body)
  if (!validated.ok) return { ok: false, reason: 'invalid_body' }

  const res = await appendSupportMessageForAdmin({
    requestId,
    body: validated.value,
    // Internal attribution only. lib/support/presenters.ts drops this before it
    // can reach the customer's thread, which always reads "צוות SocialCRM".
    authorUserId: owner.id,
  })
  if ('reason' in res) return { ok: false, reason: 'not_found' }

  revalidatePath(`/admin/support/${requestId}`)
  revalidatePath('/admin/support')
  return { ok: true }
}

export async function setSupportStatusAction(
  requestId: number,
  status: SupportStatus,
): Promise<AdminSupportActionResult> {
  const owner = await requirePlatformOwner()
  if (!owner) return { ok: false, reason: 'forbidden' }

  // Validated against the closed union before anything is written — an
  // arbitrary string must never reach the CHECK constraint and fail there.
  if (!isSupportStatus(status)) return { ok: false, reason: 'invalid_status' }

  const res = await setSupportRequestStatusForAdmin({ requestId, toStatus: status })
  if ('reason' in res) return { ok: false, reason: 'not_found' }

  revalidatePath(`/admin/support/${requestId}`)
  revalidatePath('/admin/support')
  return { ok: true }
}
