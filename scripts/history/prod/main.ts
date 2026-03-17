import { db } from '@/config/db'
// import { _get_users_perms, _users_perms } from '../../views/_users_perms'

async function run() {
  // await db.schema.renameTable('grps', 'teams')

  // await _get_users_perms()
  // await _users_perms()

  await db.schema.alterTable('sales', (table) => {
    // table.renameColumn('polisa', 'polisaNum')
    table.boolean('renew').defaultTo(false)
    table.date('polisaEndDt').nullable()
  })

  console.log('*** Done ***')
  db.destroy()
}
run()
