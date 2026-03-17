import { db } from '@/config/db'
// import { _flat_sales, _sales, _totals_and_goals } from '../../views/views'

async function run() {
  // await _totals_and_goals()
  // await db.schema.alterTable('sales', (table) => {
  //   table.text('bizNum')
  //   table.text('bizName')
  // })
  // await _sales()
  // await addUserIdToClients()
  // await _flat_sales() // only if saleDt isnt in prod
  // await addUserIdToClients()
  console.log('Done')
  db.destroy()
}

run()

async function addUserIdToClients() {
  await db('clients')
    .whereNull('userId')
    .update({
      userId: db.raw('"createdById"'),
    })
}
