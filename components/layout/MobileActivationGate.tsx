import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import { isMobileOrTabletRequest } from '@/lib/device'
import ActivationFlow from '@/components/activation/ActivationFlow'
import type { FacebookPage } from '@/lib/activation/activationState'


export default async function MobileActivationGate() {
  // Architectural rule (see lib/device.ts): mobile-only UI is gated server-side,
  // never hidden with CSS. Desktop requests get null, so this fixed z-9999
  // overlay is absent from the desktop DOM by construction and cannot flash.
  if (!(await isMobileOrTabletRequest())) return null

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
