import { db } from '@/config/db'
import { isAdmin, isAgentOrMngr } from '@/types/roles'
import { getExtUsers, getUsersAndTeams } from './usersNTeams'
import { formatSqlFilter } from '../components/filter/formatFilter'
import { UserDb } from './auth'
import { delDups } from '@/lib/funcs'

type IdName = {
  id: number
  name: string
}[]

export async function getPermsAndFilter({ filter, user }: PermsAndFilterType) {
  const rawFilter = filter ? JSON.parse(filter) : {}

  const perms = await getPerms(user)
  let extUsers = []
  if (isAgentOrMngr(user.role)) extUsers = await getExtUsers(user.id)

  // הוסף את החודש הנוכחי לאדמין
  if (isAdmin(user.role) && !rawFilter.dateRange) rawFilter.dateRange = 'החודש הנוכחי'

  // perms.gotPermIds = [...perms.gotPermIds, ...extUsers.map((u) => u.id)]
  perms.gotPermUsers = [...(perms.gotPermUsers || []), ...extUsers]

  const sqlFilter = await formatSqlFilter({ user, filter: { ...rawFilter }, gotPermIds: perms.gotPermIds })

  return { rawFilter, sqlFilter, ...perms }
}

interface PermsAndFilterType {
  filter: string
  user: UserDb
}

/// ------------------------------------------------------------
// New Perms Functions
/// ------------------------------------------------------------

export async function getPerms(user) {
  if (isAdmin(user.role)) {
    const { users, teams } = await getUsersAndTeams()

    return {
      gotPermUsers: users,
      gotPermTeams: teams,
      gotPermIds: [],
      gavePermUsers: [],
      allPermUsers: users,
      allPermIds: users.map((u) => u.id),
    }
  }

  const userId = user.id
  const queries = []

  // 1. GOT: Direct permissions (gaveId -> Me)
  const gotDirect = db('user_perms')
    .join('users', 'user_perms.gaveId', 'users.id')
    .where('user_perms.gotId', userId)
    .select('users.id', 'users.name', db.raw("'got' as type"))

  // 2. GOT: Manager permissions (Team Member -> Me/Manager)
  if (user.role === 'MNGR') {
    const gotTeam = db('user_teams as mngr_teams')
      .join('user_teams as member_teams', 'mngr_teams.teamId', 'member_teams.teamId')
      .join('users', 'member_teams.userId', 'users.id')
      .where('mngr_teams.userId', userId)
      .where('mngr_teams.type', 'mngr')
      .select('users.id', 'users.name', db.raw("'got' as type"))
    queries.push(gotTeam)
  }

  // 3. GAVE: Direct permissions (Me -> gotId)
  const gaveDirect = db('user_perms')
    .join('users', 'user_perms.gotId', 'users.id')
    .where('user_perms.gaveId', userId)
    .select('users.id', 'users.name', db.raw("'gave' as type"))
  queries.push(gaveDirect)

  // Combine using UNION ALL for performance (DB won't deduplicate)
  const allPerms = await gotDirect.unionAll(queries)

  // Separate and Deduplicate in memory
  const gotMap = new Map()
  const gaveMap = new Map()

  // Initialize with self
  if (user.role !== 'OFFICE') gotMap.set(userId, { id: userId, name: user.name })

  for (const perm of allPerms) {
    // Map.set overwrites if key exists, effectively deduplicating by ID
    if (perm.type === 'got') gotMap.set(perm.id, { id: perm.id, name: perm.name })
    else gaveMap.set(perm.id, { id: perm.id, name: perm.name })
  }

  const gotPermUsers = Array.from(gotMap.values()).sort((a, b) => a.name.localeCompare(b.name))
  const gavePermUsers = Array.from(gaveMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  return {
    gotPermIds: gotPermUsers.length ? gotPermUsers.map((u) => u.id) : [0],
    gotPermUsers,
    gavePermIds: gavePermUsers.map((u) => u.id),
    gavePermUsers,
    allPermIds: delDups([...gotPermUsers.map((u) => u.id), ...gavePermUsers.map((u) => u.id)]),
    allPermUsers: delDups([...gotPermUsers, ...gavePermUsers]),
  }
}
