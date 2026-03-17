import { db } from '@/config/db'
import { _sales } from '../../views/views'

async function run() {
  // await replacePensioniWithPensioniShotef()
  // await dropViews()

  // await dropUserCols()
  // await dropSaleCols()
  await dropTeamCols()

  console.log('Done')
  db.destroy()
}

run()

async function replacePensioniWithPensioniShotef() {
  await db('users')
    // Use quotes in the search to find only exact matches in the JSON
    .whereRaw('goals::text like \'%"פנסיוני"%\'')
    // Replace '"פנסיוני"' with '"פנסיוני-שוטף"' (including quotes)
    .update({
      goals: db.raw('replace(goals::text, \'"פנסיוני"\', \'"פנסיוני-שוטף"\')::jsonb'),
    })
}

async function dropViews() {
  await db.raw(`
    DROP VIEW IF EXISTS _users_perms;
    DROP FUNCTION IF EXISTS _get_users_perms(INT);
    DROP FUNCTION IF EXISTS _get_perms_by_role(INT, TEXT);
    DROP FUNCTION IF EXISTS _get_perm_ids(integer);
     DROP VIEW IF EXISTS _teams;
     DROP FUNCTION IF EXISTS _totals_and_goals(INT);
    `)
}

async function dropUserCols() {
  await db.schema.alterTable('users', (table) => {
    table.dropColumn('gotPermTeamIds')
    table.dropColumn('gotPermIds')
    table.dropColumn('gavePermIds')
  })
}

async function dropSaleCols() {
  await db.raw(` DROP VIEW IF EXISTS _sales;`)

  await db.schema.alterTable('sales', (table) => {
    table.dropColumn('agntId')
    table.dropColumn('agntAmount')
    table.dropColumn('agntCmsn')
    table.dropColumn('agntShare')

    table.dropColumn('agnt2Id')
    table.dropColumn('agnt2Amount')
    table.dropColumn('agnt2Cmsn')
    table.dropColumn('agnt2Share')
  })

  await _sales()
}

async function dropTeamCols() {
  await db.schema.alterTable('teams', (table) => {
    table.dropColumn('mngrIds')
    table.dropColumn('userIds')
    table.dropColumn('officeIds')
  })
}
