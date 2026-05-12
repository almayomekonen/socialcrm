import { getUser, type UserDb } from '@/db/auth'

export class AuthError extends Error {
  constructor(public reason: 'no_session' | 'suspended' | 'no_agency') {
    super(reason)
    this.name = 'AuthError'
  }
}

export async function requireUser() {
  const user = await getUser()
  if (!user) throw new AuthError('no_session')
  if (user.suspended) throw new AuthError('suspended')
  if (!user.agencyId) throw new AuthError('no_agency')
  return user
}

/**
 * Like {@link requireUser}, but narrows `agencyId` from optional to required.
 * AI server actions need this for tenant-scoped queries and to drop the
 * `agencyId!` non-null assertions. Runtime check is the same — `requireUser`
 * already throws on missing agencyId; this helper just stops the `!` from
 * spreading.
 */
export type AuthenticatedAgencyUser = UserDb & { agencyId: number }

export async function requireAgencyUser(): Promise<AuthenticatedAgencyUser> {
  const user = await requireUser()
  if (typeof user.agencyId !== 'number') throw new AuthError('no_agency')
  return user as AuthenticatedAgencyUser
}
