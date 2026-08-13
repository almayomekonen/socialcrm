import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { isCopilotInspectorEnabled } from '@/lib/ai/flags'
import MobileMoreView from '@/components/mobile/MobileMoreView'
import { visibleMoreItems } from '@/components/mobile/moreDestinations'

export const metadata: Metadata = { title: 'עוד' }

/**
 * The "עוד" tab — the mobile settings map.
 *
 * MOBILE-ONLY BY SERVER GATE (architecture-rules.md §9). A desktop request is
 * redirected to the real settings page rather than shown a stripped-down mirror
 * of it, so this route can never become a second settings surface to maintain.
 *
 * Role gating mirrors the desktop settings nav exactly — it is a VISIBILITY
 * rule, not an authorization one. Every destination still enforces its own
 * server-side checks; hiding a row a נציג cannot use is a courtesy, not a gate.
 */
export default async function MobileMorePage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  if (!((await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId))) {
    redirect('/settings/self_edit')
  }

  const items = visibleMoreItems({
    role: user.role,
    inspectorEnabled: user.role === 'ADMIN' && isCopilotInspectorEnabled(),
  })

  return <MobileMoreView name={user.name || user.email} email={user.email} items={items} />
}
