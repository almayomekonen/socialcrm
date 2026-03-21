import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { isAdmin } from '@/types/roles'
import { getPermsAndFilter } from '@/db/filter'
import { getDealTableData } from '@/db/salesTbl'
import { Provider } from '@/lib/hooksNEvents'
import { getUsers } from '@/db/usersNTeams'
import SalesNav from '@/components/sales/SalesNav'
import SalesSection from '@/components/sales/SalesSection'
import PieWrapper from '@/components/sumSales/PieWrapper'
import DashboardSummary from '@/components/dashboard/DashboardSummary'

const Filter = dynamic(() => import('@/components/filter'))

export const metadata: Metadata = {
  title: 'עסקאות',
  description: 'ניהול עסקאות ולידים',
}

export default async function SalesPage({ searchParams }) {
  const { filter, saleId, isFav, pageNum, tableLimit } = await searchParams
  const user = await getUser()
  if (!user) redirect('/auth')
  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams, gotPermIds, allPermUsers } = await getPermsAndFilter({
    user,
    filter,
  })

  const handlers = isAdmin(user.role) ? gotPermUsers : allPermUsers

  // OPTIMIZATION: Removed getPieData and getGoalsAndTotals from here
  const [{ tblData, count, sqlExport }, allUsers] = await Promise.all([
    getDealTableData(sqlFilter, { pageNum, tableLimit }),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
  ])

  const formProps = { user, officeGotPerm: gotPermUsers, saleId, allUsers }

  return (
    <Provider
      className='relative'
      props={{
        tableLength: tblData.length,
        count,
        sqlExport,
        params: { filter, saleId, isFav, pageNum, tableLimit },
        gotPermIds,
      }}
    >
      <Suspense fallback={<DashboardSummaryFallback />}>
        <DashboardSummary user={user} />
      </Suspense>


      <SalesNav user={user} />

      <Suspense>
        <Filter props={{ users: gotPermUsers, teams: gotPermTeams, rawFilter, handlers }} key={filter} />
      </Suspense>

      <Suspense fallback={<div className='h-32 animate-pulse bg-gray-100 rounded-lg mt-8' />}>
        <SalesSection props={{ formProps, data: tblData, rawFilter, params: { saleId, isFav }, user }} />
      </Suspense>

      <div className='flex items-start mt-4'>
        <Suspense fallback={<div className='h-68 w-full animate-pulse bg-gray-100 rounded-lg' />}>
          <PieWrapper sqlFilter={sqlFilter} rawFilter={rawFilter} userId={user.id} />
        </Suspense>
      </div>
    </Provider>
  )
}

function DashboardSummaryFallback() {
  return (
    <div className='mb-6'>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
        {[...Array(4)].map((_, i) => (
          <div key={i} className='num-box animate-pulse'>
            <div className='h-3 bg-gray-200 rounded w-24 mb-3' />
            <div className='h-7 bg-gray-200 rounded w-16' />
          </div>
        ))}
      </div>
    </div>
  )
}
