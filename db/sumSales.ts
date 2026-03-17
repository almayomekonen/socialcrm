import { db } from '@/config/db'
import {
  BranchesSumType,
  branchesSum,
  branchesSumAsignUser as branchesSumAsignUser,
  hebrewMonths,
  saleStats,
} from '@/db/helpers/sum_helpers'
import { WithSql } from '@/types/global'
import { getAgencyId } from './agencies'
import { removeSqlField } from './helpers/funcs'

export async function getSumBranchesByUser({ sql, userIds }: WithSql) {
  sql.table('_flat_sales').select('name as סוכן', db.raw(branchesSum)).groupBy('userId', 'name').orderBy('משוקלל', 'desc')
  const res = await sql

  return addNotIncludedUsers({ res, userIds })
}

export async function addNotIncludedUsers({ res, userIds, nameKey = 'סוכן' }) {
  const usersIn = res.map((r) => r[nameKey]) || []
  const sqlUsers = db('users')
    .select(`name as ${nameKey}`)
    .whereNotIn('name', usersIn)
    .where('agencyId', await getAgencyId())
    .whereNotIn('role', ['EXT', 'OFFICE', 'ADMIN', 'GM'])
    .orderBy('name', 'asc')

  let usersNotIn = []
  if (!userIds?.length) usersNotIn = await sqlUsers
  else usersNotIn = await sqlUsers.whereIn('id', userIds)

  return [...res, ...usersNotIn]
}

export async function getSumBranches({ sql, clientId = null }: WithSql) {
  sql.table('_flat_sales').select(db.raw(branchesSum))

  if (clientId) sql.where('clientId', clientId)

  return (await sql.first()) as unknown as BranchesSumType
}

export async function getSumBranchesByCompany({ sql }: WithSql) {
  sql.table('_flat_sales').select('company as חברה', db.raw(branchesSum)).groupBy('company').orderBy('משוקלל', 'desc')

  return await sql
}

export async function getSumBranchesByMonths({ sql }: WithSql) {
  sql
    .table('_flat_sales')
    .select(db.raw('EXTRACT(MONTH FROM "offrDt") as month'), db.raw(branchesSum))
    .whereRaw('EXTRACT(YEAR FROM "offrDt") = EXTRACT(YEAR FROM current_date)')
    .groupBy('month')
    .orderBy('month')

  const res = (await sql) as any

  return res.map(({ month, ...rest }) => ({ חודש: hebrewMonths[month - 1], ...rest }))
}

export async function getSumBranchesByTeams({ sql, teamIds }: WithSql) {
  sql = removeSqlField(sql, ['agencyId', 'userId'])

  sql
    .table('_teams as t')
    .select('t.name as צוות', db.raw(branchesSum))
    .where('t.agencyId', await getAgencyId())
    .joinRaw('LEFT JOIN _flat_sales ON "userId" = ANY(t."userIds" || t."mngrIds" || t."officeIds")')
    .groupBy('t.id', 't.name')
    .orderBy('משוקלל', 'desc')

  if (teamIds?.length) sql.whereIn('t.id', teamIds)

  return await sql
}

export async function getSumBranchesByAsignAgent({ sql }: WithSql) {
  sql.table('_flat_sales').select(db.raw(branchesSumAsignUser)).first()

  return (await sql) as unknown as BranchesSumType
}

export async function getSaleStats({ sql }: WithSql) {
  sql.table('_flat_sales').select(db.raw(saleStats)).first()

  const res = (await sql) as any

  return {
    avgSalesPerClient: res.clientsWithSales ? (res.prdctsCount / res.clientsWithSales).toFixed(2) : '0.00',
    ...res,
  }
}

export async function getGoalsAndTotals(userId) {
  // SocialCRM branches — one entry per branch in types/lists.ts BRANCHES
  // משוקלל uses cmsn (commission total); all others use tfuca (deal revenue)
  const branches = [
    { branch: 'משוקלל', val: 'cmsn',   cond: null },
    { branch: 'שירותים', val: 'tfuca', cond: "branch = 'שירותים'" },
    { branch: 'מוצרים',  val: 'tfuca', cond: "branch = 'מוצרים'" },
    { branch: 'קורסים',  val: 'tfuca', cond: "branch = 'קורסים'" },
    { branch: 'מנויים',  val: 'tfuca', cond: "branch = 'מנויים'" },
    { branch: 'חבילות',  val: 'tfuca', cond: "branch = 'חבילות'" },
    { branch: 'ייעוץ',   val: 'tfuca', cond: "branch = 'ייעוץ'" },
    { branch: 'אחר',     val: 'tfuca', cond: "branch = 'אחר'" },
  ]

  // Helper to build the SQL columns
  const buildCols = (isMonthly = false) => {
    return branches.map((b) => {
      let condition = b.cond
      // For monthly columns, add the date check
      if (isMonthly) {
        const monthCheck = 'EXTRACT(MONTH FROM "offrDt") = EXTRACT(MONTH FROM current_timestamp)'
        condition = condition ? `(${condition}) AND ${monthCheck}` : monthCheck
      }

      // Build the CASE WHEN statement
      const sumLogic = condition ? `SUM(CASE WHEN ${condition} THEN ${b.val} ELSE 0 END)` : `SUM(${b.val})` // Fallback if no condition (though yearly usually has none for total cmsn, monthly needs filter)

      const branch = isMonthly ? `monthly_${b.branch}` : b.branch
      return db.raw(`COALESCE(${sumLogic}, 0)::INT as "${branch}"`)
    })
  }

  // Execute queries in parallel
  const [totals, user] = await Promise.all([
    db('_flat_sales')
      .where('userId', userId)
      .whereNotIn('status', ['בוטל', 'נגנז'])
      .where('action', 'מכירה')
      .whereRaw('EXTRACT(YEAR FROM current_timestamp) = EXTRACT(YEAR FROM "offrDt")') // Filter by current year
      .select([...buildCols(false), ...buildCols(true)]) // Select both Yearly and Monthly columns
      .first(),
    db('users').select('goals').where('id', userId).first(),
  ])

  // Reconstruct the response objects
  const yearly_totals = {}
  const monthly_totals = {}

  branches.forEach((m) => {
    yearly_totals[m.branch] = totals?.[m.branch] || 0
    monthly_totals[m.branch] = totals?.[`monthly_${m.branch}`] || 0
  })

  return {
    yearly_totals,
    monthly_totals,
    goals: user?.goals,
  }
}

