import { db } from '@/config/db'

async function run() {
  // await getSalesWithSameAgntId()
  // await cleanupAgnt2()
  // await insertSaleUsers()
  // await dropSalesColumns()

  // await nullableSalesColumns()

  console.log('Done')
  db.destroy()
}
run()

async function getSalesWithSameAgntId() {
  const res = await db('sales').where('agntId', '=', db.ref('agnt2Id'))
  console.log('res', res)
}

async function cleanupAgnt2() {
  const res = await db.raw(`
      UPDATE sales
      SET
        "agntAmount" = "agntAmount" + "agnt2Amount",
        "agntCmsn"   = "agntCmsn" + "agnt2Cmsn",
        "agntShare"  = 100,
        "agnt2Id"    = NULL,
        "agnt2Share" = 0,
        "agnt2Amount" = 0,
        "agnt2Cmsn"  = 0
      WHERE "agntId" IS NOT NULL AND "agntId" = "agnt2Id" AND id = 1535;
    `)

  console.log('cleanupAgnt2', res)
}

async function insertSaleUsers() {
  const deleted = await db('sale_users').del()
  console.log('deleted', deleted)

  const insertPrimaryAgentsQuery = `
      INSERT INTO sale_users ("saleId", "userId", "prcnt", "amount", "cmsn")
      SELECT s.id, s."agntId", s."agntShare", s."agntAmount", s."agntCmsn"
      FROM sales s
      WHERE s."agntId" IS NOT NULL;
    `
  const insertedPrimaryAgents = await db.raw(insertPrimaryAgentsQuery)
  console.log('insertedPrimaryAgents', insertedPrimaryAgents)

  const insertSecondaryAgentsQuery = `
      INSERT INTO sale_users ("saleId", "userId", "prcnt", "amount", "cmsn")
      SELECT s.id, s."agnt2Id", s."agnt2Share", s."agnt2Amount", s."agnt2Cmsn"
      FROM sales s
      WHERE s."agnt2Id" IS NOT NULL;
    `
  // לפעמים מכניסים סוכן עם חלוקה 0 אבל זה עדיין רלוונטי
  // AND s."agnt2Share" > 0

  const insertedSecondaryAgents = await db.raw(insertSecondaryAgentsQuery)
  console.log('insertedSecondaryAgents', insertedSecondaryAgents)
}

async function dropSalesColumns() {
  // await db.raw('ALTER TABLE sales DROP COLUMN "agntId" CASCADE')
  // await db.raw('ALTER TABLE sales DROP COLUMN "agnt2Id" CASCADE')

  await db.schema.alterTable('sales', async (table) => {
    // table.dropColumn('agntShare')
    // table.dropColumn('agntAmount')
    // table.dropColumn('agntCmsn')
    // table.dropColumn('agnt2Share')
    // table.dropColumn('agnt2Amount')
    // table.dropColumn('agnt2Cmsn')
    // table.dropColumn('otherAgnt')
  })
}

async function nullableSalesColumns() {
  await db.raw('ALTER TABLE sales ALTER COLUMN "agntShare" DROP NOT NULL;')
  await db.raw('ALTER TABLE sales ALTER COLUMN "agntAmount" DROP NOT NULL;')
  await db.raw('ALTER TABLE sales ALTER COLUMN "agntId" DROP NOT NULL;')

  // await db.raw('ALTER TABLE sales DROP CONSTRAINT IF EXISTS "Sale_agntId_fkey";')
  // await db.raw('ALTER TABLE sales DROP CONSTRAINT IF EXISTS "Sale_agnt2Id_fkey";')
}
