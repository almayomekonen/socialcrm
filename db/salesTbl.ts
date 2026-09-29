import { getUser, encrypt } from '@/db/auth'
import { db } from '@/config/db'
import { WithSql } from '@/types/global'
import { removeSqlField } from './helpers/funcs'

/** Coerce an id list to a validated integer array so it can be embedded in raw
 *  SQL without any injection risk (Postgres `&& ARRAY[...]` needs a literal). */
function toIntArraySql(ids: unknown[]): string | null {
  const ints = ids.map(Number).filter(Number.isInteger)
  return ints.length ? `ARRAY[${ints.join(',')}]::INT[]` : null
}

export async function getDealTableData(
  { sql, userIds, handlerIds, clientId, isCollab }: WithSql,
  { pageNum = 1, tableLimit = 100 },
) {
  sql = removeSqlField(sql, ['userId'])
  sql.table('_sales')
  if (clientId) sql.where('clientId', clientId)

  if (userIds?.length) {
    const arr = toIntArraySql(userIds)
    if (arr) sql.whereRaw(`"userIds" && ${arr}`)
  }
  if (handlerIds?.length) sql.whereIn('handlerId', handlerIds)
  if (isCollab) sql.whereRaw('cardinality("userIds") > 1')

  // Sign the export query so the client cannot tamper with it. The client
  // round-trips this token back to getDealDataToExport, which verifies the
  // signature before executing — closing the arbitrary-SQL export vector.
  const query = sql.clone().toSQL()
  const sqlExport = await encrypt({ sql: query.sql, bindings: query.bindings })

  // The summary cards (count + revenue) come from THIS query too, so they always
  // describe exactly the rows the table shows under the active filter.
  const [countRes, tblData] = await Promise.all([
    sql.clone().count('id as count').sum('amount as revenue').first(),
    sql
      .limit(tableLimit)
      .offset((pageNum - 1) * tableLimit)
      .orderBy('updatedAt', 'desc'),
  ])

  return { tblData, count: countRes?.count || 0, revenue: Number(countRes?.revenue) || 0, sqlExport }
}

export async function getTotalDealCount(gotPermIds: number[]) {
  const query = db('_sales')
  if (gotPermIds?.length) {
    const arr = toIntArraySql(gotPermIds)
    if (arr) query.whereRaw(`"userIds" && ${arr}`)
  }
  const res = await query.count('id').first()
  return Number(res?.count || 0)
}

export async function getTablePref() {
  const user = await getUser()
  const res = await db('users').select('tblPref').where({ id: user.id }).first()

  return res?.tblPref
}

export async function getFavDeals() {
  const user = await getUser()
  const res = await db('users').select('favSaleIds').where({ id: user.id }).first()
  return res?.favSaleIds?.length ? await db('_sales').whereIn('id', res.favSaleIds) : []
}
