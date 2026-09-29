import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { isAdmin } from '@/types/roles'
import { getPermsAndFilter } from '@/db/filter'
import { getDealTableData } from '@/db/salesTbl'
import { hasAnyLeads } from '@/db/clients'
import { Provider } from '@/lib/hooksNEvents'
import { getUsers } from '@/db/usersNTeams'
import SalesNav from '@/components/sales/SalesNav'
import SalesSection from '@/components/sales/SalesSection'
import DashboardSummary from '@/components/dashboard/DashboardSummary'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'

const Filter = dynamic(() => import('@/components/filter'))

export const metadata: Metadata = {
  title: 'עסקאות',
  description: 'ניהול עסקאות ולידים',
}

export default async function SalesPage({ searchParams }) {
  const { filter, saleId, isFav, pageNum, tableLimit } = await searchParams
  const user = await getUser()
  if (!user) redirect('/auth')

  /**
   * DESKTOP-ONLY SECTION. The deals workspace is a summary strip, a filter panel
   * and a paginated grid, with no phone presentation. Returned before
   * `getPermsAndFilter` and the three parallel reads below, so a phone runs none
   * of them (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user.agencyId)) return <MobileDesktopOnly section='deals' />

  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams, gotPermIds, allPermUsers } = await getPermsAndFilter({
    user,
    filter,
  })

  const handlers = isAdmin(user.role) ? gotPermUsers : allPermUsers

  const [{ tblData, count, revenue, sqlExport }, allUsers, hasLeads] = await Promise.all([
    getDealTableData(sqlFilter, { pageNum, tableLimit }),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    hasAnyLeads(user.agencyId, gotPermIds, user.role),
  ])

  const isSystemEmpty = tblData.length === 0 && !filter

  const formProps = { user, officeGotPerm: gotPermUsers, saleId, allUsers }

  return (
    <Provider
      className='flex flex-col min-h-0 h-full relative'
      props={{
        tableLength: tblData.length,
        count,
        sqlExport,
        params: { filter, saleId, isFav, pageNum, tableLimit },
        gotPermIds,
      }}
    >
      <div className='shrink-0'>
        {/* Same filtered query as the table below — the cards follow the active filter. */}
        <DashboardSummary count={count} revenue={revenue} rawFilter={rawFilter} />
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
