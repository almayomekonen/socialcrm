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
import { isGeneralModeEnabled } from '@/lib/ai/flags'
import CopilotShell from '@/components/copilot/CopilotShell'
import WorkspaceGrid from '@/components/layout/WorkspaceGrid'
import MobileBlock from '@/components/layout/MobileBlock'
import MobileBlockAccount from '@/components/layout/MobileBlockAccount'
import { redirect } from 'next/navigation'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState, type TrialStatus } from '@/lib/trial'
import { track } from '@/lib/analytics/track'
import WelcomeTrialModal from '@/components/trial/WelcomeTrialModal'
import TrialExpiredScreen from '@/components/trial/TrialExpiredScreen'

async function LayoutContent({ children }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  let agency = null
  if (user) agency = await getAgencyById(user?.agencyId)

  // Trial gate. Fail-open: a trial-state read failure must never lock users
  // out of the CRM — fall back to LEGACY (full access, no trial UI) and log.
  let trialStatus: TrialStatus = 'LEGACY'
  try {
    const trialRow = await getAgencyTrial(user.agencyId)
    if (trialRow) trialStatus = getTrialState(trialRow, new Date()).status
  } catch (err) {
    console.error('[trial] state read failed; failing open', { userId: user.id, err: String(err) })
  }

  if (trialStatus === 'TRIAL_EXPIRED') {
    // Lazy one-time emission; deduped by the DB index, track never throws.
    await track({ agencyId: user.agencyId, userId: user.id, event: 'trial_expired' })
    return <TrialExpiredScreen />
  }

  const copilotEnabled = isCopilotEnabledForUser(user)
  // No-lead General Mode. Off by default (empty allowlist) → CopilotShell keeps
  // rendering today's CopilotPanel unchanged until an agency is opted in.
  const generalModeEnabled = isGeneralModeEnabled(user.agencyId)

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
                <CopilotShell generalModeEnabled={generalModeEnabled} />
              </WorkspaceGrid>
            </div>
            {trialStatus === 'NEVER_STARTED' && <WelcomeTrialModal />}
          </CopilotContextStoreProvider>
        </CopilotProvider>
      </PosProvider>
    </UserProvider>
  )
}

export default function AppLayout({ children }) {
  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <LayoutContent>{children}</LayoutContent>
      </Suspense>
      <MobileBlock
        accountSlot={
          <Suspense fallback={null}>
            <MobileBlockAccount />
          </Suspense>
        }
      />
    </>
  )
}
