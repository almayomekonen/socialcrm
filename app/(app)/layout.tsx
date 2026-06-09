import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getAgencyById } from '@/db/agencies'
import { countUnreadConversationsForUser } from '@/db/inboxConversationReads'
import { Roles } from '@/types/roles'
import Topbar from '@/lib/navs/Topbar'
import Nav from '@/lib/navs/Nav'
import { PosProvider, UserProvider } from '@/lib/hooksNEvents'
import { CopilotProvider } from '@/lib/copilot/useCopilot'
import { CopilotContextStoreProvider } from '@/lib/copilot/copilotContextStore'
import { isCopilotEnabledForUser } from '@/lib/copilot/featureFlag'
import CopilotShell from '@/components/copilot/CopilotShell'
import WorkspaceGrid from '@/components/layout/WorkspaceGrid'
import { redirect } from 'next/navigation'

async function LayoutContent({ children }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  let agency = null
  if (user) agency = await getAgencyById(user?.agencyId)

  const copilotEnabled = isCopilotEnabledForUser(user)

  // Per-user unread conversation count for the nav badge. Office users don't see
  // the Inbox link, so skip the query for them. Never let it break the layout.
  let inboxUnread = 0
  if (user.agencyId && user.role !== Roles.OFFICE) {
    inboxUnread = await countUnreadConversationsForUser(user.agencyId, user.id).catch(() => 0)
  }

  return (
    <UserProvider user={user}>
      <PosProvider>
        <CopilotProvider enabled={copilotEnabled}>
          <CopilotContextStoreProvider>
            <div className='flex flex-col h-dvh min-h-0 items-stretch'>
              <Topbar user={user} />
              <WorkspaceGrid>
                <Nav user={user} inboxUnread={inboxUnread} />
                <main className='wrap mt-2 min-w-0 min-h-0 overflow-y-auto'>{children}</main>
                <CopilotShell />
              </WorkspaceGrid>
            </div>
          </CopilotContextStoreProvider>
        </CopilotProvider>
      </PosProvider>
    </UserProvider>
  )
}

export default function AppLayout({ children }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LayoutContent>{children}</LayoutContent>
    </Suspense>
  )
}
