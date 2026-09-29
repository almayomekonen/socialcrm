import { getUser } from '@/db/auth'
import { getPermsAndFilter } from '@/db/filter'
import { resolvePerformanceFilter } from '@/lib/filter/resolvePerformanceFilter'
import { Metadata } from 'next'
import { getTablePref } from '@/db/salesTbl'
import { getSumBranchesByMonths } from '@/db/sumSales'
import GeneralTable from '@/components/sumSales/GeneralTable'

export const metadata: Metadata = {
  title: 'סיכום עסקאות לפי חודשים',
  description: 'סיכום עסקאות של נציגים לפי חודשים',
}

export default async function SumMonthsSalePage({ searchParams }) {
  const user = await getUser()

  const filter = await resolvePerformanceFilter(user?.id, (await searchParams).filter)
  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams } = await getPermsAndFilter({
    user,
    filter,
  })

  const tblData = await getSumBranchesByMonths(sqlFilter)
  const tblPref = await getTablePref()

  return (
    <div>
      <GeneralTable
        data={tblData}
        tblPref={tblPref}
        user={user}
        tblId='sumMonthsSale753'
        filterProps={{ users: gotPermUsers, teams: gotPermTeams, rawFilter }}
        key={Math.random()}
      />
    </div>
  )
}
