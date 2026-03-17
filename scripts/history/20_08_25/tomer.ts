// Script to modify the 'promo' table and add a computed column to the 'sales' table
import { db } from '@/config/db'

async function modifyPromos() {
  const sql = db('promo').select('id', 'goals') //
  const res = await sql

  for (const r of res) {
    const { id, goals } = r
    const keys = Object.keys(goals.target)

    goals.conditions = keys.map((key) => ({ branch: key }))

    await db('promo').where('id', id).update({ goals })
  }
}

async function addTfuca() {
  await db.raw(`
          alter table sales add column tfuca NUMERIC GENERATED ALWAYS AS (
          CASE 
              WHEN "prdctType" LIKE '%חודשית%' THEN amount * 12
              ELSE amount
          END
          ) STORED;
      `)
}

async function backfillSaleUserTfuca() {
  await db.raw(`
    UPDATE
      sale_users
    SET
      tfuca = s.tfuca * (sale_users.prcnt / 100)
    FROM
      sales s
    WHERE
      sale_users."saleId" = s.id;
  `)
}

async function main() {
  // await backfillSaleUserTfuca()
  // await addTfuca()
  // await modifyPromos()

  console.log('Done')
  db.destroy()
}

main()
