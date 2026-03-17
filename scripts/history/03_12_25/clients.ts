import { db } from '@/config/db'

async function run() {
  await addIdNumDate()
  console.log('Done')
  db.destroy()
}

run()

async function addIdNumDate() {
  await db.schema.alterTable('clients', (table) => {
    table.date('idNumDate').nullable()
  })
}
