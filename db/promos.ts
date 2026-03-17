import { db } from '@/config/db'
import { Knex } from 'knex'
import { filesJsonAgg, imgJsonAgg } from './helpers/aggregations'
import { getAgencyId } from './agencies'

const promoFields = ['p.id', 'p.title', 'p.desc', 'p.end', 'p.start', 'p.goals', 'p.grpIds', 'p.isPromoGrp', 'p.userIds']

export async function getPromo(id: number) {
  // Subquery to get all user IDs associated with the promo (directly or via groups)
  const combinedIdsQuery = db('promo as p')
    .where('p.id', id)
    .select(db.raw('unnest(p."userIds") as id')) // Direct users
    .union(
      // Users via Groups (regular users)
      db('promo as p')
        .join('user_teams as ut', db.raw('ut."teamId" = ANY(p."grpIds")'))
        .where('p.id', id)
        .select('ut.userId as id'),
    )

  const promo = await db('promo as p')
    .leftJoin('files as main_img', 'p.img', 'main_img.id')
    .leftJoin('files as f', db.raw('f.id = ANY(p.files)'))
    .where('p.id', id)
    .select([
      ...promoFields,
      db.raw('p.goals::text as goals'), // Override if needed or rely on driver
      db.raw(`${imgJsonAgg} AS img`),
      db.raw(`${filesJsonAgg} AS files`),
      db.raw(`(SELECT array_agg(DISTINCT x.id) FROM (${combinedIdsQuery.toQuery()}) as x) as combined_ids`),
    ])
    .groupBy('p.id', 'main_img.id', 'main_img.name', 'main_img.url', 'main_img.type')
    .first()

  return promo
}

export async function getPromos() {
  const agencyId = await getAgencyId()

  const promos = await db('promo as p')
    .leftJoin('files as main_img', 'p.img', 'main_img.id')
    .leftJoin('files as f', db.raw('f.id = ANY(p.files)'))
    .where('p.agencyId', agencyId)
    .select([...promoFields, db.raw(`${imgJsonAgg} AS img`), db.raw(`${filesJsonAgg} AS files`)])
    .groupBy('p.id', 'main_img.id', 'main_img.name', 'main_img.url', 'main_img.type')
    .orderBy('p.updatedAt', 'desc')

  return promos
}

export async function getPromosByUserId(userId, gotPermIds) {
  const regularPromos = db('promo as p')
    .select('p.*')
    .distinctOn('p.id')
    .leftJoin('user_teams as ut', db.raw('ut."teamId" = ANY(p."grpIds")')) // Join teams assigned to promo
    .where('p.isPromoGrp', false)
    .andWhere(function () {
      // Check intersection with gotPermIds
      this.whereRaw('p."userIds" && ?', [gotPermIds]).orWhereIn('ut.userId', gotPermIds)
    })

  // 2. Group Promos (isPromoGrp = true) -> Managers only
  const groupPromos = db('promo as p')
    .select('p.*')
    .distinctOn('p.id')
    .join('user_teams as ut', function () {
      this.on(db.raw('ut."teamId" = ANY(p."grpIds")')).andOnVal('ut.type', '=', 'mngr') // Only managers
    })
    .where('p.isPromoGrp', true)
    .andWhere('ut.userId', userId) // Current user is the manager

  // Combine them
  const combinedPromos = regularPromos.unionAll([groupPromos])

  // Final Query with file aggregation
  const res = await db
    .with('filtered_promos', combinedPromos)
    .select([
      // Manually select fields to ensure goals is casted
      'p.id',
      'p.title',
      'p.desc',
      'p.end',
      'p.start',
      db.raw('p.goals::text as goals'),
      'p.grpIds',
      'p.isPromoGrp',
      'p.userIds',
      db.raw(`${imgJsonAgg} AS img`),
      db.raw(`${filesJsonAgg} AS files`),
    ])
    .from('filtered_promos as p')
    .leftJoin('files as main_img', 'p.img', 'main_img.id')
    .leftJoin('files as f', db.raw('f.id = ANY(p.files)'))
    .groupBy(
      'p.id',
      'p.title',
      'p.desc',
      'p.end',
      'p.start',
      'p.grpIds',
      'p.isPromoGrp',
      'p.userIds',
      db.raw('p.goals::text'),
      'main_img.id',
      'p.updatedAt',
    )
    .orderBy('p.updatedAt', 'desc')

  return res
}

export async function getPromoTotals(conditions, sql) {
  let userTotals = []

  for (const prdct of conditions) {
    const res = prdct.branch === 'משוקלל' ? await getUsersCmsn(prdct, sql.clone()) : await getUserTotalsByCond(prdct, sql.clone())

    userTotals = [...userTotals, ...res]
  }

  return formatTotalResult(userTotals)
}

export async function getUsersCmsn(prdct, sql) {
  const { companies } = prdct

  sql.table('_flat_sales').select('userId', 'name').sum('cmsn').groupBy('userId', 'name')
  if (companies?.length) sql.whereIn('company', companies)

  const res = await sql
  return res
}

export async function getUserTotalsByCond(prdct, sql: Knex.QueryBuilder) {
  const { branch, prdcts, prdctTypes, companies } = prdct
  sql.table('_flat_sales').select('userId', 'name', 'branch').where({ branch }).sum('tfuca').groupBy('userId', 'name', 'branch')

  if (prdctTypes?.length) sql.whereIn('prdctType', prdctTypes)
  if (prdcts?.length) sql.whereIn('prdct', prdcts)
  if (companies?.length) sql.whereIn('company', companies)

  return await sql
}

function formatTotalResult(allData) {
  const users = {}

  for (const el of allData) {
    const { userId, name, branch, sum } = el
    if (!users[userId]) users[userId] = { נציג: name }
    users[userId] = { ...users[userId], [branch || 'משוקלל']: sum }
  }

  return Object.values(users)
}

interface PropsGetPromoTotalsTeams {
  sql: Knex.QueryBuilder
  conditions: any[]
}

export async function getTeamsPromoTotals({ sql, conditions }: PropsGetPromoTotalsTeams) {
  let teamsTotals = []

  for (const prdct of conditions) {
    const res = await getTeamTotals(sql.clone(), prdct)
    teamsTotals = [...teamsTotals, ...res]
  }
  return formatTeamTotals(teamsTotals)
}

function getTeamTotals(
  sql: Knex.QueryBuilder,
  filters?: { branch?: string; prdctTypes?: string[]; prdcts?: string[]; companies?: string[] },
) {
  sql
    .table('teams as t')
    .select('t.name as צוות')
    .leftJoin('user_teams as ut', 't.id', 'ut.teamId')
    .leftJoin('_flat_sales as fs', 'ut.userId', 'fs.userId')
    .groupBy('t.id', 't.name')

  if (filters) {
    const { branch, prdctTypes, prdcts, companies } = filters
    if (branch) {
      const isTfuca = branch !== 'משוקלל'
      sql.select(db.raw(`sum(${isTfuca ? 'tfuca' : 'cmsn'}) as ${branch}`))
      if (isTfuca) sql.where('branch', branch)
    }

    if (prdctTypes?.length) sql.whereIn('prdctType', prdctTypes)
    if (prdcts?.length) sql.whereIn('prdct', prdcts)
    if (companies?.length) sql.whereIn('company', companies)
  }

  return sql
}

function formatTeamTotals(data: any[]) {
  const teams = new Map<string, any>()

  for (const item of data) {
    const teamName = item['צוות']
    if (!teamName) continue

    const existingTeam = teams.get(teamName) || { צוות: teamName }

    for (const key in item) {
      if (key !== 'צוות') {
        existingTeam[key] = item[key]
      }
    }
    teams.set(teamName, existingTeam)
  }

  return Array.from(teams.values())
}
