import { db } from '@/config/db'

async function migrateUserPerms(validUserIds: Set<number>) {
  const users = await db('users')
    .select('id', 'gavePermIds', 'gotPermIds')
    .where((b) => b.whereNotNull('gavePermIds').orWhereNotNull('gotPermIds'))

  const userPermsToInsert: any[] = []
  const uniquePerms = new Set<string>()

  for (const user of users) {
    // 1. gavePermIds: "I (gaveId) give permission to X (gotId)"
    if (Array.isArray(user.gavePermIds)) {
      for (const granteeId of user.gavePermIds) {
        if (validUserIds.has(user.id) && validUserIds.has(granteeId)) {
          const key = `${user.id}-${granteeId}` // gaveId-gotId
          if (!uniquePerms.has(key)) {
            uniquePerms.add(key)
            userPermsToInsert.push({ gaveId: user.id, gotId: granteeId })
          }
        }
      }
    }

    // 2. gotPermIds: "I (gotId) got permission from X (gaveId)"
    if (Array.isArray(user.gotPermIds)) {
      for (const granterId of user.gotPermIds) {
        if (validUserIds.has(user.id) && validUserIds.has(granterId)) {
          const key = `${granterId}-${user.id}` // gaveId-gotId
          if (!uniquePerms.has(key)) {
            uniquePerms.add(key)
            userPermsToInsert.push({ gaveId: granterId, gotId: user.id })
          }
        }
      }
    }
  }

  console.log('userPermsToInsert', userPermsToInsert)

  if (userPermsToInsert.length > 0) {
    await db('user_perms').insert(userPermsToInsert).onConflict(['gotId', 'gaveId']).ignore()
    console.log(`Inserted ${userPermsToInsert.length} user_perms records.`)
  }
}

async function migrateTeamMembers(validUserIds: Set<number>) {
  const teams = (await db('teams')) as any
  const userTeamsToInsert: any[] = []

  for (const team of teams) {
    if (!Array.isArray(team.userIds)) continue

    for (const userId of team.userIds) {
      if (!validUserIds.has(userId)) continue

      userTeamsToInsert.push({
        userId: userId,
        teamId: team.id,
        type: 'user',
      })
    }

    if (!Array.isArray(team.mngrIds)) continue

    for (const mngrId of team.mngrIds) {
      if (!validUserIds.has(mngrId)) continue

      userTeamsToInsert.push({
        userId: mngrId,
        teamId: team.id,
        type: 'mngr',
      })
    }
  }

  if (userTeamsToInsert.length > 0) {
    await db('user_teams').insert(userTeamsToInsert).onConflict(['userId', 'teamId']).merge(['type'])
    console.log(`Inserted ${userTeamsToInsert.length} user_teams records.`)
  }
}

async function removeAllOfficeGavePerms() {
  const officeUserIds = await db('users').where('role', 'OFFICE').pluck('id')
  await db('user_perms').whereIn('gaveId', officeUserIds).del()
}

async function migrate() {
  console.log('Starting migration...')

  // MIGRATE USER PERMS
  const allUserIds = await db('users').pluck('id')
  const validUserIds = new Set(allUserIds)

  await migrateUserPerms(validUserIds)

  // MIGRATE TEAMS
  await migrateTeamMembers(validUserIds)

  await removeAllOfficeGavePerms()

  console.log('Done')
  db.destroy()
}

migrate()

// pnpm mig migrate_perms
