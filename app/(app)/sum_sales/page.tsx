import { getUser } from '@/db/auth'
import { getPermsAndFilter } from '@/db/filter'
import AllNumbox from '@/components/sumSales/AllNumbox'
import { getGoalsAndTotals } from '@/db/sumSales'
import SumSalesPie from '@/components/sumSales/SumSalesPie'
import { getPieData } from '@/db/sum_pie'

export default async function SumSalePage({ searchParams }) {
  const user = await getUser()

  const { filter } = await searchParams

  const { rawFilter, sqlFilter, gotPermUsers, gotPermTeams } = await getPermsAndFilter({
    user,
    filter,
  })

  const sqlQuery = sqlFilter.sql.table('_flat_sales').toSQL()
  const pieData = await getPieData({ sql: sqlQuery.sql, bindings: sqlQuery.bindings })
  const goalsAndTotals = await getGoalsAndTotals(user.id)

  const filterProps = { users: gotPermUsers, teams: gotPermTeams, rawFilter }

  return (
    <div>
      <SumSalesPie pieData={pieData} goalsAndTotals={goalsAndTotals} rawFilter={rawFilter} filterProps={filterProps} />
      <AllNumbox props={{ user, rawFilter, sqlFilter }} />
    </div>
  )
}
