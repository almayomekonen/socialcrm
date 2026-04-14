import { getUser } from '@/db/auth'

export async function requireUser() {
  const user = await getUser()
  if (!user || user.suspended) throw new Error('Unauthorized')
  if (!user.agencyId) throw new Error('Invalid user')
  return user
}
