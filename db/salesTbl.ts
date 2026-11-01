import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { WithSql } from '@/types/global'
import { removeSqlField } from './helpers/funcs'

/** Coerce an id list to a validated integer array so it can be embedded in raw
 *  SQL without any injection risk (Postgres `&& ARRAY[...]` needs a literal). */
function toIntArraySql(ids: unknown[]): string | null {
  const ints = ids.map(Number).filter(Number.isInteger)
  return ints.length ? `ARRAY[${ints.join(',')}]::INT[]` : null
}

/**
 * The deals table's query for one active filter — the single definition the
 * table, its summary cards and the export all use. `sqlFilter` comes from
 * `getPermsAndFilter`, so it is already scoped to the session's agency and the
 * reps the user may see.
 */
function dealsQuery({ sql, userIds, handlerIds, clientId, isCollab }: WithSql) {
  sql = removeSqlField(sql, ['userId'])
  sql.table('_sales')
  if (clientId) sql.where('clientId', clientId)

  if (userIds?.length) {
    const arr = toIntArraySql(userIds)
    if (arr) sql.whereRaw(`"userIds" && ${arr}`)
  }
  if (handlerIds?.length) sql.whereIn('handlerId', handlerIds)
  if (isCollab) sql.whereRaw('cardinality("userIds") > 1')
  return sql
}

export async function getDealTableData(sqlFilter: WithSql, { pageNum = 1, tableLimit = 100 }) {
  const sql = dealsQuery(sqlFilter)

  // The summary cards (count + revenue) come from THIS query too, so they always
  // describe exactly the rows the table shows under the active filter.
  const [countRes, tblData] = await Promise.all([
    sql.clone().count('id as count').sum('amount as revenue').first(),
    sql
      .limit(tableLimit)
      .offset((pageNum - 1) * tableLimit)
      .orderBy('updatedAt', 'desc'),
  ])

  return { tblData, count: countRes?.count || 0, revenue: Number(countRes?.revenue) || 0 }
}

/**
 * Every row of the table under the same filter, without paging — what the
 * export downloads. Built on the server from `sqlFilter`; the client never
 * supplies or carries a query. The agency predicate is repeated here so the
 * export stays tenant-scoped even if the filter builder changes.
 */
export async function getDealExportRows(sqlFilter: WithSql, agencyId: number) {
  return dealsQuery(sqlFilter).where('agencyId', agencyId)
}

/**
 * Whether ANY deal exists in this agency within the user's permission scope —
 * no filter applied. The deals page asks this only when the filtered table came
 * back empty, to tell "no deals at all" (onboarding) from "the filter matches
 * nothing" (normal filtered UI). Same scoping as the table: admins see the whole
 * agency, everyone else the deals of the users they have permission for.
 */
export async function hasAnyDeals(agencyId: number, gotPermIds: number[] | undefined): Promise<boolean> {
  // Base tables, not the aggregating _sales view: `"userIds" && ids` there is
  // exactly "some sale_users row of this sale belongs to one of ids".
  const query = db('sales').where('sales.agencyId', agencyId)
  const ids = (gotPermIds ?? []).map(Number).filter(Number.isInteger)
  if (ids.length) {
    query.whereExists(db('sale_users').whereRaw('sale_users."saleId" = sales.id').whereIn('sale_users.userId', ids))
  }
  const row = await query.select(db.raw('1')).first()
  return !!row
}

/**
 * The deals page's onboarding ("no deals yet") decision: the filtered table is
 * empty AND the user's scope has no deals at all. Existence is only checked when
 * the table is empty, so the usual case costs no extra query.
 */
export async function isDealsSystemEmpty(rowsShown: number, agencyId: number, gotPermIds: number[] | undefined): Promise<boolean> {
  if (rowsShown > 0) return false
  return !(await hasAnyDeals(agencyId, gotPermIds))
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
