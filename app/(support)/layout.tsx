import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getDisplayName } from '@/lib/users/displayName'
import SupportShell from '@/components/support/SupportShell'
import Loading from '@/components/ui/Loading'

/**
 * The Support Center route group.
 *
 * NOT gated by requireProductAccess, and NOT subject to the (app) layout's
 * phone redirect. Those two rules turn away exactly three populations — expired
 * trials, never-activated workspaces, and every mobile user — and those are the
 * people most likely to need to reach us. A support surface that goes dark when
 * the product is blocked defeats its own purpose.
 *
 * The redirect below is a UX convenience, NOT an authorization boundary: every
 * page and every action calls requireAgencyUser() independently and never
 * assumes this ran. A layout is not an authorization boundary in the App Router.
 *
 * Under cacheComponents the uncached cookie read must sit inside Suspense, the
 * same shape (app) and /activate already use.
 */
async function SupportLayoutContent({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  if (user.suspended) redirect('/api/auth/clear')
  if (!user.agencyId) redirect('/auth')

  // Resolve the name HERE and hand the shell only that. The session object
  // stays in the layout rather than being threaded through the subtree.
  return <SupportShell displayName={getDisplayName(user)}>{children}</SupportShell>
}

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <SupportLayoutContent>{children}</SupportLayoutContent>
    </Suspense>
  )
}
