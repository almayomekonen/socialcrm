import { getPieData } from '@/db/sum_pie'
import { getGoalsAndTotals } from '@/db/sumSales'
import MeshuklalSchumPie from './MeshuklalSchumPie'
import { WithSql } from '@/types/global'

export default async function PieWrapper({ sqlFilter, rawFilter, userId }) {
  const serialized = serializeSql(sqlFilter.sql)

  const [pieData, goalsAndTotals] = await Promise.all([getPieData(serialized), getGoalsAndTotals(userId)])

  return <MeshuklalSchumPie goalsAndTotals={goalsAndTotals} className='w-fit' data={pieData} rawFilter={rawFilter} />
}

function serializeSql(sql: WithSql) {
  const query = sql.table('_flat_sales').toSQL()
  return { sql: query.sql, bindings: query.bindings }
}
