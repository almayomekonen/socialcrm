import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getAgencyById } from '@/db/agencies'
import { getTrialPreviewLeads } from '@/db/clients'
import { getPerms } from '@/db/filter'
import { countUnreadConversationsForUser } from '@/db/inboxConversationReads'
import { Roles } from '@/types/roles'
import Topbar from '@/lib/navs/Topbar'
import Nav from '@/lib/navs/Nav'
import { PosProvider, UserProvider } from '@/lib/hooksNEvents'
import { CopilotProvider } from '@/lib/copilot/useCopilot'
import { CopilotContextStoreProvider } from '@/lib/copilot/copilotContextStore'
import { isCopilotEnabledForUser } from '@/lib/copilot/featureFlag'
import { isGeneralModeEnabled } from '@/lib/ai/flags'
import { isInboxDeltaSyncEnabled } from '@/lib/flags/inboxFlags'
import { AwarenessProvider } from '@/modules/inbox/awareness/AwarenessContext'
import CopilotShell from '@/components/copilot/CopilotShell'
import WorkspaceGrid from '@/components/layout/WorkspaceGrid'
import ActivationFlow from '@/components/activation/ActivationFlow'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState, type TrialStatus } from '@/lib/trial'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { track } from '@/lib/analytics/track'
import WelcomeTrialModal from '@/components/trial/WelcomeTrialModal'
import TrialExpiredScreen from '@/components/trial/TrialExpiredScreen'

async function LayoutContent({ children }) {
  const user = await getUser()
  if (!user) redirect('/api/auth/clear')
  let agency = null
  if (user) agency = await getAgencyById(user?.agencyId)

  let trialStatus: TrialStatus = 'LEGACY'
  try {
    const trialRow = await getAgencyTrial(user.agencyId)
    if (trialRow) trialStatus = getTrialState(trialRow, new Date()).status
  } catch (err) {
    console.error('[trial] state read failed; failing open', { userId: user.id, err: String(err) })
  }

  // Platform owners are never gated by the trial — they run the app, not a tenant.
  const owner = isPlatformOwner(user.email)
  // Owner-only preview escape hatch: lets the owner force-render the paywall to
  // inspect it despite the exemption. Set in the browser console with
  //   document.cookie = 'preview_paywall=1;path=/'
  // and clear it with
  //   document.cookie = 'preview_paywall=;path=/;max-age=0'
  const previewPaywall = owner && (await cookies()).get('preview_paywall')?.value === '1'
  const trialExpired = (trialStatus === 'TRIAL_EXPIRED' && !owner) || previewPaywall
  let leadPreview = { total: 0, names: [] as string[] }
  if (trialExpired) {
    if (!previewPaywall) await track({ agencyId: user.agencyId, userId: user.id, event: 'trial_expired' })
    try {
      const { gotPermIds } = await getPerms(user)
      leadPreview = await getTrialPreviewLeads(user.agencyId, gotPermIds, user.role)
    } catch (err) {
      console.error('[trial] lead preview read failed', { userId: user.id, err: String(err) })
    }
  }

  const copilotEnabled = isCopilotEnabledForUser(user)
  const generalModeEnabled = isGeneralModeEnabled(user.agencyId)

  let inboxUnread = 0
  if (user.agencyId && user.role !== Roles.OFFICE) {
    inboxUnread = await countUnreadConversationsForUser(user.agencyId, user.id).catch(() => 0)
  }

  const deltaSyncEnabled = isInboxDeltaSyncEnabled()

  return (
    <AwarenessProvider enabled={deltaSyncEnabled} initialUnread={inboxUnread}>
    <UserProvider user={user}>
      <PosProvider>
        <CopilotProvider enabled={copilotEnabled}>
          <CopilotContextStoreProvider>
            <div className='flex flex-col h-dvh min-h-0 items-stretch'>
              <Topbar user={user} />
              <WorkspaceGrid>
                <Nav user={user} inboxUnread={inboxUnread} isOwner={isPlatformOwner(user.email)} />
                <main className='wrap mt-2 min-w-0 min-h-0 overflow-y-auto'>{children}</main>
                <CopilotShell generalModeEnabled={generalModeEnabled} />
              </WorkspaceGrid>
            </div>
            {trialExpired && <TrialExpiredScreen leadCount={leadPreview.total} leadNames={leadPreview.names} />}
            {trialStatus === 'NEVER_STARTED' && <WelcomeTrialModal />}
          </CopilotContextStoreProvider>
        </CopilotProvider>
      </PosProvider>
    </UserProvider>
    </AwarenessProvider>
  )
}

export default function AppLayout({ children }) {
  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <LayoutContent>{children}</LayoutContent>
      </Suspense>
      <Suspense fallback={null}>
        <ActivationFlow />
      </Suspense>
    </>
  )
}
