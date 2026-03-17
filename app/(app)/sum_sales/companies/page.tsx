import { getUser } from '@/db/auth'
import { getPermsAndFilter } from '@/db/filter'
import { Metadata } from 'next'
import { getTablePref } from '@/db/salesTbl'
import { getSumBranchesByCompany } from '@/db/sumSales'
import GeneralTable from '@/components/sumSales/GeneralTable'

export const metadata: Metadata = {
  title: 'סיכום עסקאות לפי ספקים',
  description: 'סיכום עסקאות של נציגים לפי ספקים',
}

export default async function SumCompaniesSalePage({ searchParams }) {
  const user = await getUser()
  const { filter } = await searchParams

  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams } = await getPermsAndFilter({
    user,
    filter,
  })

  const tblData = await getSumBranchesByCompany(sqlFilter)
  const tblPref = await getTablePref()

  return (
    <div>
      <GeneralTable
        data={tblData}
        tblPref={tblPref}
        user={user}
        tblId='sumCompaniesSale754'
        filterProps={{ users: gotPermUsers, teams: gotPermTeams, rawFilter }}
        key={Math.random()}
      />
    </div>
  )
}
