import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { isAdmin } from '@/types/roles'
import { getPermsAndFilter } from '@/db/filter'
import { getSaleTableData } from '@/db/salesTbl'
import { Provider } from '@/lib/hooksNEvents'
import { getUsers } from '@/db/usersNTeams'
import SalesNav from '@/components/sales/SalesNav'
import SalesSection from '@/components/sales/SalesSection'
import PieWrapper from '@/components/sumSales/PieWrapper'
import DashboardSummary from '@/components/dashboard/DashboardSummary'
import Link from 'next/link'

const Filter = dynamic(() => import('@/components/filter'))

export const metadata: Metadata = {
  title: 'עסקאות',
  description: 'ניהול עסקאות ולידים',
}

export default async function SalesPage({ searchParams }) {
  const { filter, saleId, isFav, pageNum, tableLimit } = await searchParams
  const user = await getUser()
  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams, gavePermUsers, gotPermIds, allPermUsers } = await getPermsAndFilter({
    user,
    filter,
  })

  const handlers = isAdmin(user.role) ? gotPermUsers : allPermUsers

  // OPTIMIZATION: Removed getPieData and getGoalsAndTotals from here
  const [{ tblData, count, sqlExport }, allUsers] = await Promise.all([
    getSaleTableData(sqlFilter, { pageNum, tableLimit }),
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

      {tblData.length === 0 && (
        <div className='rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-6 mb-6 text-center'>
          <p className='font-semibold text-lg mb-1'>ברוך הבא! עדיין אין לידים במערכת</p>
          <p className='text-gray-500 text-sm mb-4'>כדי להתחיל לעבוד, הוסף את הלידים הראשונים שלך</p>
          <div className='flex gap-3 justify-center flex-wrap'>
            <Link
              href='/settings/self_edit?tab=upload'
              className='inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors'
            >
              העלה קובץ לידים
            </Link>
            <Link
              href='/?saleId=new'
              className='inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors'
            >
              הוסף ליד ידנית
            </Link>
          </div>
          <p className='text-gray-400 text-xs mt-3'>💡 הדרך הכי מהירה להתחיל: העלה קובץ Excel עם הלידים שלך</p>
        </div>
      )}
      <SalesNav user={user} />
      <div className='flex items-start mt-4'>
        <Suspense fallback={<div className='h-68 w-full animate-pulse bg-gray-100 rounded-lg' />}>
          <PieWrapper sqlFilter={sqlFilter} rawFilter={rawFilter} userId={user.id} />
        </Suspense>
      </div>

      <Suspense>
        <Filter props={{ users: gotPermUsers, teams: gotPermTeams, rawFilter, handlers }} key={filter} />
      </Suspense>

      <Suspense fallback={<div className='h-32 animate-pulse bg-gray-100 rounded-lg mt-8' />}>
        <SalesSection props={{ formProps, data: tblData, rawFilter, params: { saleId, isFav }, user }} />
      </Suspense>
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
