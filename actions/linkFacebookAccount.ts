'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { db } from '@/config/db'
import { getUserByFacebookSub } from '@/db/auth'
import { AuthError, requireUser } from '@/lib/requireUser'
import { canUseFacebookUserAuth } from '@/lib/auth/facebookUserAuthFlags'
import { isFacebookSubUniqueViolation } from '@/lib/auth/fbLoginProof'
import { resolveFacebookLink } from '@/lib/auth/resolveFacebookLink'
import { verifyFacebookAccessToken } from '@/lib/auth/verifyFacebookAccessToken'

export type LinkFacebookAccountResult = { ok: true } | { fail: true; msg: string }

/**
 * Attach a Meta-verified Facebook user id to the authenticated SocialCRM user.
 * Reads only `accessToken`. Session identity comes from the cookie — never from
 * client `userId` / `facebookSub` / email.
 */
export async function linkFacebookAccount(input: { accessToken?: string }): Promise<LinkFacebookAccountResult> {
  const start = Date.now()

  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) {
      const msg = err.reason === 'suspended' ? 'המשתמש מושהה' : 'ההתחברות נכשלה, נסה שוב'
      console.warn(`[AUTH] route=facebook_link ms=${Date.now() - start} result=fail reason=${err.reason}`)
      return { fail: true, msg }
    }
    throw err
  }

  if (!canUseFacebookUserAuth(user.agencyId)) {
    console.log(`[AUTH] route=facebook_link userId=${user.id} ms=${Date.now() - start} result=fail reason=not_allowlisted`)
    return { fail: true, msg: 'התחברות עם Facebook אינה זמינה לחשבון זה' }
  }

  const verified = await verifyFacebookAccessToken(input?.accessToken)
  if (verified.ok === false) {
    console.warn(`[AUTH] route=facebook_link userId=${user.id} ms=${Date.now() - start} result=fail reason=${verified.reason}`)
    if (verified.reason === 'no_email') {
      return { fail: true, msg: 'פייסבוק לא החזיר אימייל. אפשר להתחבר עם גוגל או עם מייל.' }
    }
    return { fail: true, msg: 'ההתחברות נכשלה, נסה שוב' }
  }

  const facebookSub = verified.identity.sub
  const row = await db('users').where({ id: user.id }).first('facebookSub')
  const existingOwner = await getUserByFacebookSub(facebookSub)
  const resolution = resolveFacebookLink({
    facebookSub,
    sessionUserId: user.id,
    currentFacebookSub: row?.facebookSub,
    existingOwnerId: existingOwner?.id,
  })

  if (resolution.kind === 'reject') {
    const reason = resolution.reason
    const msg =
      reason === 'already_linked_other'
        ? 'החשבון כבר מחובר לפייסבוק אחר'
        : 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.'
    console.log(`[AUTH] route=facebook_link userId=${user.id} ms=${Date.now() - start} result=fail reason=${reason}`)
    return { fail: true, msg }
  }

  if (resolution.kind === 'already_linked') {
    console.log(`[AUTH] route=facebook_link userId=${user.id} ms=${Date.now() - start} result=success reason=already_linked`)
    return { ok: true }
  }

  try {
    await db('users').where({ id: user.id }).update({ facebookSub })
  } catch (err) {
    if (isFacebookSubUniqueViolation(err as { code?: string; constraint?: string; detail?: string })) {
      console.log(`[AUTH] route=facebook_link userId=${user.id} ms=${Date.now() - start} result=fail reason=taken`)
      return { fail: true, msg: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.' }
    }
    throw err
  }

  revalidateTag('user' + user.id, 'default')
  revalidatePath('/settings/update_security')
  console.log(`[AUTH] route=facebook_link userId=${user.id} ms=${Date.now() - start} result=success`)
  return { ok: true }
}
