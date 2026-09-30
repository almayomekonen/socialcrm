import { getUser } from '@/db/auth'
import { getPermsAndFilter } from '@/db/filter'
import { resolveActiveFilter } from '@/lib/filter/resolveActiveFilter'
import { isMngr } from '@/types/roles'
import { getTablePref } from '@/db/salesTbl'
import { getSumBranchesByUser } from '@/db/sumSales'
import GeneralTable from '@/components/sumSales/GeneralTable'

export default async function SumSalePage({ searchParams }) {
  const user = await getUser()
  if (!isMngr(user.role)) return <div>not allowed</div>

  const filter = await resolveActiveFilter('performance', user?.id, (await searchParams).filter)

  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams } = await getPermsAndFilter({
    user,
    filter,
  })
  const filterProps = { users: gotPermUsers, teams: gotPermTeams, rawFilter }
  const tblData = await getSumBranchesByUser(sqlFilter)
  const tblPref = await getTablePref()

  return (
    <div>
      <GeneralTable
        data={tblData}
        tblPref={tblPref}
        user={user}
        tblId='sumSale237'
        filterProps={filterProps}
        key={Math.random()}
      />
    </div>
  )
}
