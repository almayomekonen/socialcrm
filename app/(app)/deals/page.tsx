import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { isAdmin } from '@/types/roles'
import { getPermsAndFilter } from '@/db/filter'
import { getDealTableData, isDealsSystemEmpty } from '@/db/salesTbl'
import { resolveActiveFilter } from '@/lib/filter/resolveActiveFilter'
import { hasAnyLeads } from '@/db/clients'
import { Provider } from '@/lib/hooksNEvents'
import { getUsers } from '@/db/usersNTeams'
import SalesNav from '@/components/sales/SalesNav'
import SalesSection from '@/components/sales/SalesSection'
import DashboardSummary from '@/components/dashboard/DashboardSummary'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

const Filter = dynamic(() => import('@/components/filter'))

/** Tab title in the interface language — Hebrew ('עסקאות') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('deals.page.title'), description: t('deals.page.description') }
}

export default async function SalesPage({ searchParams }) {
  const { filter: urlFilter, saleId, isFav, pageNum, tableLimit } = await searchParams
  const user = await getUser()
  if (!user) redirect('/auth')

  /**
   * DESKTOP-ONLY SECTION. The deals workspace is a summary strip, a filter panel
   * and a paginated grid, with no phone presentation. Returned before
   * `getPermsAndFilter` and the three parallel reads below, so a phone runs none
   * of them (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user.agencyId)) return <MobileDesktopOnly section='deals' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)

  // Explicit ?filter= wins; otherwise the user's remembered deals filter; otherwise the default.
  const filter = await resolveActiveFilter('deals', user.id, urlFilter)

  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams, gotPermIds, allPermUsers } = await getPermsAndFilter({
    user,
    filter,
  })

  const handlers = isAdmin(user.role) ? gotPermUsers : allPermUsers

  const [{ tblData, count, revenue }, allUsers, hasLeads] = await Promise.all([
    getDealTableData(sqlFilter, { pageNum, tableLimit }),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    hasAnyLeads(user.agencyId, gotPermIds, user.role),
  ])

  // Onboarding only when the user's scope has NO deals at all — not when the
  // active (possibly remembered) filter just matches nothing.
  const isSystemEmpty = await isDealsSystemEmpty(tblData.length, user.agencyId, gotPermIds)

  const formProps = { user, officeGotPerm: gotPermUsers, saleId, allUsers }

  return (
    <Provider
      className='flex flex-col min-h-0 h-full relative'
      regionAttrs={regionAttrs(locale)}
      props={{
        tableLength: tblData.length,
        count,
        // The export rebuilds its query on the server from this same filter.
        exportFilter: filter ?? null,
        params: { filter, saleId, isFav, pageNum, tableLimit },
        gotPermIds,
      }}
    >
      <div className='shrink-0'>
        {/* Same filtered query as the table below — the cards follow the active filter. */}
        <DashboardSummary count={count} revenue={revenue} rawFilter={rawFilter} locale={locale} />
      </div>

      <div className='shrink-0'>
        <Suspense fallback={null}>
          <SalesNav user={user} isSystemEmpty={isSystemEmpty} />
        </Suspense>
      </div>

      {!isSystemEmpty && (
        <div className='shrink-0'>
          <Suspense>
            <Filter props={{ users: gotPermUsers, teams: gotPermTeams, rawFilter, handlers }} key={filter} />
          </Suspense>
        </div>
      )}

      <Suspense fallback={<div className='h-32 animate-pulse bg-gray-100 rounded-lg mt-8' />}>
        <SalesSection props={{ formProps, data: tblData, rawFilter, params: { saleId, isFav }, user, isSystemEmpty, hasLeads, fillHeight: true }} />
      </Suspense>

    </Provider>
  )
}
