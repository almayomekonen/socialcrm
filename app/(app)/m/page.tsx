import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import MobileMoreView from '@/components/mobile/MobileMoreView'

export const metadata: Metadata = { title: 'עוד' }

/**
 * The "עוד" tab — the mobile workspace's fourth destination.
 *
 * Exists because `/settings/self_edit`, the desktop settings entry, renders
 * `SettingsChrome` with its own sidebar of eighteen links; pointing a phone tab
 * at it would put a second navigation inside a shell that already has one. This
 * is a short list of the things that genuinely work on a phone today, plus an
 * honest pointer to the desktop for everything else.
 *
 * MOBILE-ONLY BY SERVER GATE (architecture-rules.md §9). A desktop request is
 * redirected to the real settings page rather than shown a stripped-down mirror
 * of it, so this route can never become a second settings surface to maintain.
 *
 * Every row is a REAL existing destination. Nothing here is a placeholder — a
 * tab full of disabled rows would be worse than no tab.
 */
export default async function MobileMorePage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  if (!((await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId))) {
    redirect('/settings/self_edit')
  }

  return <MobileMoreView name={user.name || user.email} email={user.email} />
}
