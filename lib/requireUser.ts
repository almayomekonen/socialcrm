import { getUser } from '@/db/auth'

export async function requireUser() {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  return user
}
