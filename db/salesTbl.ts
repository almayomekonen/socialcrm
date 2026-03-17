import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { WithSql } from '@/types/global'
import { removeSqlField } from './helpers/funcs'

export async function getSaleTableData(
  { sql, userIds, handlerIds, clientId, isCollab }: WithSql,
  { pageNum = 1, tableLimit = 100 },
) {
  sql = removeSqlField(sql, ['userId'])
  sql.table('_sales')
  if (clientId) sql.where('clientId', clientId)

  if (userIds?.length) sql.whereRaw(`"userIds" && ARRAY[${userIds}]::INT[]`)
  if (handlerIds?.length) sql.whereIn('handlerId', handlerIds)
  if (isCollab) sql.whereRaw('cardinality("userIds") > 1')

  // const sqlExport = sql.clone()
  const query = sql.clone().toSQL()
  const sqlExport = { sql: query.sql, bindings: query.bindings }

  const [countRes, tblData] = await Promise.all([
    sql.clone().count('id').first(),
    sql
      .limit(tableLimit)
      .offset((pageNum - 1) * tableLimit)
      .orderBy('updatedAt', 'desc'),
  ])

  return { tblData, count: countRes?.count || 0, sqlExport }
}

export async function getTablePref() {
  const user = await getUser()
  const res = await db('users').select('tblPref').where({ id: user.id }).first()

  return res?.tblPref
}

export async function getFavSales() {
  const user = await getUser()
  const res = await db('users').select('favSaleIds').where({ id: user.id }).first()
  return res?.favSaleIds?.length ? await db('_sales').whereIn('id', res.favSaleIds) : []
}

// export async function getSaleTableData({ where, userIds, handlerIds, clientId }, { pageNum = 1, tableLimit = 100 }) {
//   const sql = db('_sales').where(where)

//   if (clientId) sql.where('clientId', clientId)

//   if (userIds?.length) sql.whereRaw(`"userIds" && ARRAY[${userIds}]::INT[]`)
//   if (handlerIds?.length) sql.whereIn('handlerId', handlerIds)

//   const { count } = await sql.clone().count('id').first()

//   const res = await sql
//     .limit(tableLimit)
//     .offset((pageNum - 1) * tableLimit)
//     .orderBy('updatedAt', 'desc')

//   return { tblData: res, count, pageNum, tableLimit }
// }
