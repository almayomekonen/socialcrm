import { getUser } from '@/db/auth'
import { getPermsAndFilter } from '@/db/filter'
import { resolveActiveFilter } from '@/lib/filter/resolveActiveFilter'
import { Metadata } from 'next'
import { getTablePref } from '@/db/salesTbl'
import { getSumBranchesByMonths } from '@/db/sumSales'
import GeneralTable from '@/components/sumSales/GeneralTable'
import { getServerT } from '@/lib/i18n/server'

/** Tab title in the interface language — Hebrew outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('performance.page.monthsTitle'), description: t('performance.page.monthsDescription') }
}

export default async function SumMonthsSalePage({ searchParams }) {
  const user = await getUser()

  const filter = await resolveActiveFilter('performance', user?.id, (await searchParams).filter)
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
