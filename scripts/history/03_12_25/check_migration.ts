import { db } from '@/config/db'

async function checkMigration() {
  console.log('Starting migration check...')

  const users = await db('users').select('id', 'name', 'gavePermIds', 'gotPermIds')

  let discrepancies = 0

  for (const user of users) {
    // ---------------------------------------------------
    // CHECK 1: "Who I gave permission to" (gavePermIds)
    // ---------------------------------------------------
    // Old: user.gavePermIds
    // New: select gotId from user_perms where gaveId = user.id

    const oldGave = new Set((user.gavePermIds || []).map(Number))
    const newGaveRaw = await db('user_perms').where('gaveId', user.id).pluck('gotId')
    const newGave = new Set(newGaveRaw.map(Number))

    // Find differences
    const missedGave = [...oldGave].filter((id: any) => !newGave.has(id))
    const extraGave = [...newGave].filter((id) => !oldGave.has(id))

    if (missedGave.length > 0) {
      console.log(`[User ${user.id} ${user.name}] Missing "gave permission to":`, missedGave)
      discrepancies++
    }

    // ---------------------------------------------------
    // CHECK 2: "Who gave permission to me" (gotPermIds)
    // ---------------------------------------------------
    // Old: user.gotPermIds
    // New: getUsersWhoGavePerm(user.id) (Logic: Direct + Team Manager)

    const oldGot = new Set((user.gotPermIds || []).map(Number))

    const newGotRaw = await getUsersWhoGavePerm(user.id)
    const newGotIds = new Set(newGotRaw.map((u) => Number(u.id)))

    const missedGot = [...oldGot].filter((id: any) => !newGotIds.has(id))
    // const extraGot = [...newGotIds].filter(id => !oldGot.has(id)) // Extra is fine (maybe new logic covers more)

    if (missedGot.length > 0) {
      console.log(`[User ${user.id} ${user.name}] Missing "got permission from":`, missedGot)

      // detailed debug for the first few failures
      if (discrepancies < 5) {
        // Check if it was supposed to be via Team Manager
        const isMngr = await db('user_teams').where({ userId: user.id, type: 'mngr' }).first()
        if (isMngr) {
          console.log(`  -> User is a manager. Might be missing team members?`)
        } else {
          console.log(`  -> User is NOT a manager. Should be in direct user_perms.`)
        }
      }
      discrepancies++
    }
  }

  if (discrepancies === 0) {
    console.log('✅ Success! No discrepancies found between old arrays and new tables.')
  } else {
    console.log(`❌ Found discrepancies for ${discrepancies} users.`)
  }

  db.destroy()
}

checkMigration()

export async function getUsersWhoGavePerm(userId: number) {
  // 1. Direct permissions: Users who explicitly gave permission to this user
  const directPerms = db('user_perms')
    .join('users', 'user_perms.gaveId', 'users.id')
    .where('user_perms.gotId', userId)
    .select('users.id', 'users.name')

  // 2. Team Manager permissions: Users in teams where this user is a manager
  const teamPerms = db('user_teams as mngr_teams') // Teams where I am manager
    .join('user_teams as member_teams', 'mngr_teams.teamId', 'member_teams.teamId') // Join to find other members in same team
    .join('users', 'member_teams.userId', 'users.id') // Get user details
    .where('mngr_teams.userId', userId)
    .where('mngr_teams.type', 'mngr') // I must be a manager
    .select('users.id', 'users.name')

  // Combine using UNION to avoid duplicates
  return await directPerms.union(teamPerms)
}
