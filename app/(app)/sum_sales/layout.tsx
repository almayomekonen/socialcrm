import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getUsers } from '@/db/usersNTeams'
import SumSalesNav from '@/components/sumSales/SumSalesNav'
import { Metadata } from 'next'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { isAdmin, type Roles } from '@/types/roles'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

/** Tab title in the interface language — Hebrew ('ביצועים') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('performance.page.title'), description: t('performance.page.description') }
}

export default async function SumSalesLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  /**
   * DESKTOP-ONLY SECTION — gated at the LAYOUT because ביצועים is five pages
   * (overview, נציגים, חברות, חודשים, צוותים) that share one desktop sub-nav and
   * one desktop-only report surface. One gate here covers all five and, unlike a
   * gate per page, guarantees `SumSalesNav` and `children` are never rendered
   * for a phone at all — the report queries in each page never run
   * (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='sum_sales' />

  // Resolved once by the same request-memoised call the (app) layout makes; the five pages inherit this region.
  const { locale } = await getUiLocaleState(user)

  let showAgents = false
  try {
    const users = await getUsers()
    showAgents = Array.isArray(users) && users.length > 1
  } catch {
    showAgents = false
  }

  return (
    <div {...regionAttrs(locale)}>
      <Suspense fallback={null}>
        <SumSalesNav
          user={user}
          showAgents={showAgents}
          showAds={!!user && isAdmin(user.role as Roles) && isFacebookAdsReportingEnabledForAgency(user.agencyId)}
        />
      </Suspense>
      {children}
    </div>
  )
}
