import { getUser } from '@/db/auth'

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
