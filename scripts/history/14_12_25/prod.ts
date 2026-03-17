import { db } from '@/config/db'
import { _teams } from '../../views/views'

async function run() {
  // await _teams()
  // await removeMainCntractIdFromContracts()
  // await removeTeamIdFromUsers()
  await removeTeamIdFromTeams()
  console.log('done')
  db.destroy()
}

run()

async function removeMainCntractIdFromContracts() {
  await db.schema.alterTable('contracts', (table) => {
    table.dropColumn('mainCntrctId')
  })
}

async function removeTeamIdFromUsers() {
  await db.schema.alterTable('users', (table) => {
    table.dropColumn('teamId')
    table.dropColumn('subTeamId')
  })
}

async function removeTeamIdFromTeams() {
  await db.schema.alterTable('teams', (table) => {
    table.dropColumn('teamId')
  })
}
