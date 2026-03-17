import { db } from '@/config/db'

async function run() {
  // await addMainCntrctIdToContracts()
  // await updateCmsnRules()

  console.log('Done')
  db.destroy()
}

run()

async function addMainCntrctIdToContracts() {
  await db.schema.alterTable('contracts', (table) => {
    table.integer('mainCntrctId').references('id').inTable('contracts').onDelete('set null')
  })
}

async function updateCmsnRules() {
  await db.raw('UPDATE cmsn_rules SET "cmsnRate" = "cmsnRate" * 100')
  await db.raw('UPDATE cmsn_rules SET "cmsnRate" = "cmsnRate" / 12 WHERE "prdctTypes"::text LIKE \'%חודשית%\'')
}
