import { db } from '@/config/db'
import { User, UserInfo } from '@/types/db/tables'
import { filesJsonAgg } from './helpers/aggregations'
import { getAgencyId } from './agencies'

type GetUsersOptions = {
  withOfficeUsers?: boolean
  withExtUsers?: boolean
}

type GetTeamsOptions = {
  id?: number
  ids?: number[]
}

export async function getTeams(opts: GetTeamsOptions = {}) {
  const agencyId = await getAgencyId()

  const sql = db('_teams').select('id', 'name', 'userIds', 'mngrIds', 'officeIds', 'updatedAt').where('agencyId', agencyId)

  if (opts.id) sql.where('id', opts.id)
  if (opts.ids) sql.whereIn('id', opts.ids)
  return await sql
}

export function getExtUsers(createdById?) {
  const sql = db('users').where({ role: 'EXT' }).orderBy('name')
  if (createdById) sql.where({ createdById })
  return sql
}

export async function getUsers(opts: GetUsersOptions = {}) {
  const agencyId = await getAgencyId()

  const sql = db('users').select('id', 'name', 'role').where('agencyId', agencyId)
  if (!opts.withOfficeUsers) sql.whereNot('role', 'OFFICE')
  if (!opts.withExtUsers) sql.whereNot('role', 'EXT')
  return await sql.orderBy('name')
}

export async function getAllPropsUsers(): Promise<any[]> {
  const agencyId = await getAgencyId()

  return await db('users as u')
    .select([
      'u.*',
      db('user_perms as up')
        .select(db.raw(`JSON_AGG(JSON_BUILD_OBJECT('id', u2.id, 'name', u2.name) ORDER BY u2.name, u2.id)`))
        .join('users as u2', 'up.gotId', 'u2.id')
        .whereRaw('up."gaveId" = u.id')
        .as('gavePerm'),
      db('user_perms as up')
        .select(db.raw(`JSON_AGG(JSON_BUILD_OBJECT('id', u3.id, 'name', u3.name) ORDER BY u3.name, u3.id)`))
        .join('users as u3', 'up.gaveId', 'u3.id')
        .whereRaw('up."gotId" = u.id')
        .as('gotPerm'),
    ])
    .where('u.agencyId', agencyId)
    .orderByRaw('u."updatedAt" DESC NULLS LAST')
}

// Admin
export async function getAllTeams() {
  const agencyId = await getAgencyId()

  const res = await db('_teams')
    .where('agencyId', agencyId)
    .select('id', 'name', 'users', 'mngrs', 'offices')
    .orderBy('updatedAt', 'desc')

  return res
}

// FIX: without EXT users
export async function getUsersAndTeams() {
  const users = await getUsers({ withOfficeUsers: true, withExtUsers: true })
  const teams = await getTeams()
  return { users, teams }
}

export async function getUserNameById(userId) {
  const res = (await db('users').where({ id: userId }).select('name').first())?.name
  return res
}

export type UserKey = keyof User | keyof UserInfo

export async function getFullUser({ id, select }: { id: number; select?: UserKey[] }) {
  let query = db('users as u').join('users_info as ui', 'u.id', 'ui.id').where('u.id', id)

  const columnsToSelect = select ? select.filter((col) => col !== 'agentLicenseFiles') : ['u.*', 'ui.*']

  query.select(columnsToSelect)

  if (select?.includes('agentLicenseFiles')) {
    query
      .leftJoin('files as f', db.raw('f.id = ANY(ui."agentLicenseFiles")'))
      .select(
        db.raw(`
       ${filesJsonAgg} AS "agentLicenseFiles"
      `),
      )
      .groupBy('u.id', 'ui.id')
  }

  const user = await query.first()

  return user ? { ...user, id: id } : undefined
}

// extUsers

export async function getExtUsersCreatedByUser(userId) {
  const res = await db('users').where({ role: 'EXT', createdById: userId })
  return res
}

export async function getDefaultSettings(userId) {
  const res = await db('default_settings').where({ userId }).first()
  return res
}

export async function getIpAddress() {
  const response = await fetch('https://api.ipify.org?format=json')
  const data = await response.json()
  return data.ip
}

export async function getTeamNUserNames(teamIds, userIds) {
  const [teams, users] = await Promise.all([
    db('teams').whereIn('id', teamIds).select('name'),
    db('users').whereIn('id', userIds).select('name'),
  ])

  const teamNames = teams.map((team) => team.name)
  const userNames = users.map((user) => user.name)
  return { teamNames, userNames }
}
