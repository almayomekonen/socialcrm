import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import ActivationFlow from '@/components/activation/ActivationFlow'
import type { FacebookPage } from '@/lib/activation/activationState'

/**
 * Server-side data gate for the mobile activation flow. Reads the existing
 * connection and decrypts the pending-pages cookie, then injects both into the
 * client flow. Recovery: a missing / expired / invalid / wrong-user cookie all
 * resolve to an empty list — the FSM maps that to `failed` → deterministic restart.
 */
export default async function MobileActivationGate() {
  const user = await getUser()
  if (!user) return null

  const connection = await db('facebook_pages').where({ user_id: user.id }).first()

  let pending: FacebookPage[] = []
  const cookie = (await cookies()).get('fb_pages')?.value
  if (cookie) {
    try {
      const payload = await decrypt(cookie)
      if (payload?.userId === user.id && Array.isArray(payload.pages)) {
        pending = payload.pages as FacebookPage[]
      }
    } catch {
      // expired / tampered / invalid — leave pending empty
    }
  }

  return <ActivationFlow initialPages={pending} alreadyConnected={!!connection} />
}
