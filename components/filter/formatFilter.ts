import { UserDb } from '@/actions/auth'
import { getDateRange } from '@/lib/dates'
import { db } from '@/config/db'
import { Knex } from 'knex'
import { getTeams } from '../../db/usersNTeams'
import { getPerms } from '@/db/filter'

type Props = {
  user: UserDb
  filter: any
  gotPermIds?: number[] | boolean
}

export async function formatSqlFilter({ user, filter, gotPermIds }: Props) {
  const query = db.clearWhere() as Knex.QueryBuilder

  const userIds = await getPermUsers(user, filter, gotPermIds)
  if (userIds?.length) query.whereIn('userId', userIds)

  query.where('agencyId', user.agencyId)

  if (filter.replace) query.where('replace', true)

  if (!filter.action) query.where('action', 'מכירה')
  else if (filter.action !== 'הכל') query.where('action', filter.action)

  if (filter.status?.[0] !== 'הכל') {
    if (!filter.status?.length) query.whereNotIn('status', ['נגנז', 'בוטל'])
    else query.whereIn('status', filter.status)
  }

  if (filter.month) query.whereRaw(`EXTRACT(MONTH FROM "offrDt") = ?`, [filter.month])
  if (filter.year) query.whereRaw(`EXTRACT(YEAR FROM "offrDt") = ?`, [filter.year])

  if (filter.dateRange && filter.dateRange != 'כל התאריכים') {
    if (filter.dateRange !== 'מותאם אישית') {
      const { start, end } = getDateRange(filter.dateRange) as any
      query.whereBetween('offrDt', [start, end])
    } else query.whereBetween('offrDt', [filter.start, filter.end])
  }

  if (filter.month) query.whereRaw(`EXTRACT(MONTH FROM "saleDt") = ?`, [filter.month])
  if (filter.year) query.whereRaw(`EXTRACT(YEAR FROM "saleDt") = ?`, [filter.year])

  if (filter.saleDtRange && filter.saleDtRange != 'כל התאריכים') {
    if (filter.saleDtRange !== 'מותאם אישית') {
      const { start, end } = getDateRange(filter.saleDtRange) as any
      query.whereBetween('saleDt', [start, end])
    } else query.whereBetween('saleDt', [filter.saleDtStart, filter.saleDtEnd])
  }

  if (filter.company?.length) query.whereIn('company', filter.company)
  if (filter.branch) query.where('branch', filter.branch)
  if (filter.prdct?.length) query.whereIn('prdct', filter.prdct)
  if (filter.prdctType?.length) query.whereIn('prdctType', filter.prdctType)

  if (filter.clientIds?.length) query.whereIn('clientId', filter.clientIds)

  // const { teamIds, handlerIds, clientId } = filter

  return {
    ...filter,
    get sql(): Knex.QueryBuilder {
      return query.clone()
    },
    userIds,
  }
}

// ---------------------------------------------
// הרשאות צפייה בסוכנים
// ---------------------------------------------

async function getPermUsers(user, filter, gotPermIds) {
  if (!gotPermIds?.length) gotPermIds = (await getPerms(user)).gotPermIds

  const mapRoles = {
    AGNT: permRes,
    MNGR: permRes,
    OFFICE: permRes,
    ADMIN: async () => {
      let userIds = []
      if (filter.userIds) userIds.push(...filter.userIds)

      if (filter.teamIds) {
        const res = await db('user_teams').whereIn('teamId', filter.teamIds).select('userId')

        const ids = res.map((obj) => obj.userId)
        userIds.push(...ids)
      }
      return userIds
    },
    GM: () => mapRoles.ADMIN(),
  }

  async function permRes() {
    const userIds = []

    if (filter.userIds) userIds.push(...filter.userIds)

    if (filter.teamIds) {
      const res = await getTeams({ ids: filter.teamIds })
      const ids = res.flatMap((el) => (Array.isArray(el.userIds) ? el.userIds : []))

      userIds.push(...ids)
    }

    if (userIds.length) {
      const isAllowed = userIds.every((id) => gotPermIds.includes(Number(id)))
      if (isAllowed) return userIds
    }

    return gotPermIds
  }

  return mapRoles[user.role]()
}
