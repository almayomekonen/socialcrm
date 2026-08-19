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
import { NotificationProvider } from '@/modules/notifications/NotificationContext'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'
import { countUnreadNotifications } from '@/db/notifications/feed'
import { CrmSyncHealthProvider } from '@/lib/polling/CrmSyncHealthContext'
import CopilotShell from '@/components/copilot/CopilotShell'
import WorkspaceGrid from '@/components/layout/WorkspaceGrid'
import { isOnboarded } from '@/lib/activation/onboarding'
import { getActiveDeviceOverride, getDeviceClass, isMobileRequest } from '@/lib/device'
import DeviceOverrideLinks from '@/components/dev/DeviceOverrideLinks'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import MobileWorkspaceShell from '@/components/mobile/MobileWorkspaceShell'
import SkipLink from '@/components/layout/SkipLink'
import OAuthResultToast from '@/components/settings/OAuthResultToast'
import Loading from '@/components/ui/Loading'
import MobileChromeSkeleton from '@/components/mobile/skeletons/MobileChromeSkeleton'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState, type TrialStatus } from '@/lib/trial'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { getAgencyPlan } from '@/lib/quota'
import { track, trackOncePerAgency } from '@/lib/analytics/track'
import { after } from 'next/server'
import WelcomeTrialModal from '@/components/trial/WelcomeTrialModal'
import TrialExpiredScreen from '@/components/trial/TrialExpiredScreen'
import WorkspaceTeaser from '@/components/trial/WorkspaceTeaser'
import { ActivationCelebrationProvider } from '@/components/trial/ActivationCelebrationContext'
import ProActivationSuccess from '@/components/trial/ProActivationSuccess'
import EducationMount from '@/components/education/EducationMount'

async function LayoutContent({ children }) {
  const user = await getUser()
  if (!user) redirect('/api/auth/clear')

  if (user.suspended) redirect('/api/auth/clear')

  /**
   * MOBILE ENTRY (Phase 2). The redirect that has always sent every phone to
   * /activate now has exactly ONE exemption: an agency explicitly allowlisted
   * for the mobile workspace.
   *
   * `canEnterMobileWorkspace` requires BOTH `MOBILE_WORKSPACE_ENABLED=1` AND the
   * agency id in `MOBILE_WORKSPACE_AGENCY_ALLOWLIST`. Absence blocks: with the
   * env unset — production and every preview right now — `mobileWorkspace` is
   * false for everyone and the next line is byte-for-byte the old behaviour.
   *
   * NOTHING ELSE IS BYPASSED. This exemption sits AFTER the session and
   * suspension checks and BEFORE the onboarding gate, the trial gate and the
   * teaser, all of which run unchanged below for mobile and desktop alike. It
   * decides one thing only: whether a phone is redirected away, or continues
   * through the same checks a desktop request faces.
   */
  const isMobile = await isMobileRequest()
  const mobileWorkspace = isMobile && canEnterMobileWorkspace(user.agencyId)
  if (isMobile && !mobileWorkspace) redirect('/activate')

  // Local-development only; null in production. See the render site below.
  const deviceOverride = await getActiveDeviceOverride()

  if (!(await isOnboarded(user.agencyId))) redirect('/activate')
  let agency = null
  if (user) agency = await getAgencyById(user?.agencyId)

  let trialStatus: TrialStatus = 'LEGACY'
  // Preserve the full getTrialState result (status + daysRemaining) from the
  // SAME existing read — reused for the header PRO pill; no extra DB query.
  let trialDaysRemaining: number | null = null
  try {
    const trialRow = await getAgencyTrial(user.agencyId)
    if (trialRow) {
      const trialState = getTrialState(trialRow, new Date())
      trialStatus = trialState.status
      trialDaysRemaining = trialState.daysRemaining
    }
  } catch (err) {
    console.error('[trial] state read failed; failing open', { userId: user.id, err: String(err) })
  }
  
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

  /**
   * WORKSPACE REACHED. The denominator for every in-product metric, and the one
   * the funnel audit found missing: `desktop_first_access` only fires while the
   * trial is NEVER_STARTED, so it goes silent the moment a trial starts and can
   * never measure "did this agency actually get into the product".
   *
   * Emitted here — after the onboarding, trial and teaser decisions have all been
   * made — so it means the REAL workspace with page children, not the teaser.
   * (`trialExpired` and NEVER_STARTED both render WorkspaceTeaser below and are
   * excluded, which is exactly the distinction that makes the event usable.)
   *
   * once-per-agency, best effort, inside `after()` so the existence check runs
   * post-response and never adds latency to a page render. See
   * `trackOncePerAgency` for the documented limitation vs. the DB index.
   */
  if (!trialExpired && trialStatus !== 'NEVER_STARTED') {
    const surface = mobileWorkspace ? 'mobile' : 'desktop'
    after(() => trackOncePerAgency(user.agencyId, 'workspace_first_viewed', user.id, { surface }))
    if (mobileWorkspace) {
      after(() => trackOncePerAgency(user.agencyId, 'mobile_workspace_viewed', user.id, {}))
    }
  }

  /**
   * Notifications (spec §13). Mounted ALONGSIDE AwarenessProvider, not instead of
   * it: the awareness path keeps owning the nav conversation badge and the WhatsApp
   * toast until it is retired in P2.6, so P2.2 cannot regress either.
   *
   * Gated on the workspace actually rendering. A blocked user sees WorkspaceTeaser,
   * and polling a feed that would 403 every few seconds serves nobody.
   */
  const notificationsEnabled =
    isNotificationsEnabled() &&
    isNotificationsAgencyAllowlisted(user.agencyId) &&
    !trialExpired &&
    trialStatus !== 'NEVER_STARTED'

  /**
   * The mobile tab bar's NOTIFICATION badge.
   *
   * Read separately from `inboxUnread` because they are separate facts:
   * `inboxUnread` counts unread WhatsApp CONVERSATIONS and clears by replying,
   * this counts unread NOTIFICATION rows and clears by reading them. The tab bar
   * shows both, on their own tabs — see `mobileTabsWithBadges` for the defect
   * this replaces.
   *
   * MOBILE-ONLY WORK. Desktop gets its notification count from
   * `NotificationContext`'s poll (the bell), so this read would be pure waste on
   * a desktop request — hence the `mobileWorkspace` guard, which also keeps the
   * desktop render path byte-identical.
   *
   * Gated on `notificationsEnabled` for the same reason the provider is: with the
   * feature off there is nothing to count, and `/api/notifications/*` would 404
   * anyway. `.catch(() => 0)` mirrors `inboxUnread` exactly — a badge is never
   * worth failing a workspace render over.
   */
  let notificationUnread = 0
  if (mobileWorkspace && notificationsEnabled && user.agencyId) {
    notificationUnread = await countUnreadNotifications({ agencyId: user.agencyId, userId: user.id }).catch(() => 0)
  }

  return (
    <CrmSyncHealthProvider>
    <AwarenessProvider enabled={deltaSyncEnabled} initialUnread={inboxUnread}>
    <NotificationProvider enabled={notificationsEnabled}>
    <UserProvider user={user}>
      <PosProvider>
        <CopilotProvider enabled={copilotEnabled}>
          <CopilotContextStoreProvider>
            <ActivationCelebrationProvider>
            <EducationMount
              userId={user.id}
              surface={mobileWorkspace ? 'mobile' : 'desktop'}
              copilotEnabled={copilotEnabled}
              toursEnabled={!trialExpired && trialStatus !== 'NEVER_STARTED' && !mobileWorkspace}
            >
            {/*
              LOCAL DEVELOPMENT ONLY. `getActiveDeviceOverride()` returns null
              outside `next dev`, and with null this component renders its
              children unwrapped — no context provider, no listener, no
              behavioural change. It WRAPS rather than sits alongside because one
              of its two jobs is supplying a router on `AppRouterContext`, which
              only descendants can read.

              Mounted here — above the shell choice — so it covers the mobile
              shell, the desktop shell and the teaser alike.
            */}
            <DeviceOverrideLinks device={deviceOverride}>
            <div className='flex flex-col h-dvh min-h-0 items-stretch'>
              <SkipLink />
              <OAuthResultToast />
              {trialStatus === 'NEVER_STARTED' || trialExpired ? (
                // Blocked (no active product access): render a presentation-only
                // teaser INSTEAD of the real workspace + page {children}, so the
                // CRM is never server-rendered or streamed to a user without
                // access. Deleting the modal/blur in DevTools reveals only the
                // inert teaser. Authorization is still enforced server-side at the
                // product boundaries (requireProductAccess) — this is the render
                // isolation half of the defense. Owners/LEGACY/PAID/TRIAL_ACTIVE
                // are never blocked (trialExpired already carries the owner
                // exemption; NEVER_STARTED shows the activation modal as before).
                <WorkspaceTeaser />
              ) : mobileWorkspace ? (
                /**
                 * The mobile workspace. Rendered INSTEAD of Topbar + WorkspaceGrid
                 * — never alongside it, and never as a CSS-hidden duplicate: a
                 * desktop request cannot reach this branch, so the mobile chrome
                 * is absent from its HTML entirely (architecture-rules.md §9).
                 *
                 * CopilotShell is deliberately not mounted. It is a desktop panel
                 * (33 components) and Phase 11 owns its mobile form; shipping it
                 * here would cost bundle weight on the exact devices that can
                 * least afford it, for a surface with no mobile design yet.
                 */
                <MobileWorkspaceShell notificationCount={notificationUnread} conversationCount={inboxUnread}>
                  {children}
                </MobileWorkspaceShell>
              ) : (
                <>
                  <Topbar
                    user={user}
                    isPro={(await getAgencyPlan(user.agencyId)) === 'pro'}
                    trialDaysRemaining={trialStatus === 'TRIAL_ACTIVE' ? trialDaysRemaining : null}
                  />
                  <WorkspaceGrid>
                    <Nav user={user} inboxUnread={inboxUnread} isOwner={isPlatformOwner(user.email)} />
                    <main id='main-content' tabIndex={-1} className='wrap mt-2 min-w-0 min-h-0 overflow-y-auto focus:outline-none'>
                      {children}
                    </main>
                    <CopilotShell generalModeEnabled={generalModeEnabled} />
                  </WorkspaceGrid>
                </>
              )}
            </div>
            {trialExpired && <TrialExpiredScreen leadCount={leadPreview.total} leadNames={leadPreview.names} />}
            {trialStatus === 'NEVER_STARTED' && <WelcomeTrialModal />}
            {/* One-time Pro activation celebration. Rendered only for the real
                TRIAL_ACTIVE workspace; self-gates on justActivated so it appears
                only right after a genuine activation, never on refresh/re-login. */}
            {trialStatus === 'TRIAL_ACTIVE' && <ProActivationSuccess />}
            </DeviceOverrideLinks>
            </EducationMount>
            </ActivationCelebrationProvider>
          </CopilotContextStoreProvider>
        </CopilotProvider>
      </PosProvider>
    </UserProvider>
    </NotificationProvider>
    </AwarenessProvider>
    </CrmSyncHealthProvider>
  )
}

export default function AppLayout({ children }) {
  /**
   * TWO SUSPENSE LAYERS, because Cache Components forbids `headers()` in the
   * layout itself.
   *
   * PhoneAwareShell is headers-only (User-Agent, which does not change between
   * tab navigations) so the INNER fallback can be MobileChromeSkeleton on a
   * phone and the existing spinner on desktop. It must not read the request
   * path: `x-socialcrm-path` changes every client navigation and would
   * re-suspend this shell, replacing the live tab bar with chrome skeleton.
   *
   * LayoutContent still suspends on `getUser()` — that is the wait the user
   * actually sees on a cold load. Route `loading.tsx` files are synchronous
   * and must stay that way (see EntityLoading).
   */
  return (
    <Suspense fallback={<div className='h-dvh bg-bg' aria-busy='true' />}>
      <PhoneAwareShell>{children}</PhoneAwareShell>
    </Suspense>
  )
}

async function PhoneAwareShell({ children }) {
  const phone = (await getDeviceClass()) === 'phone'
  return (
    <Suspense fallback={phone ? <MobileChromeSkeleton /> : <Loading />}>
      <LayoutContent>{children}</LayoutContent>
    </Suspense>
  )
}
