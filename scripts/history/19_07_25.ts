import { db } from '@/config/db'

async function run() {
  // await db.schema.alterTable('sales', (t) => t.renameColumn('respId', 'handlerId'))

  await db.schema.dropView('_sales')

  await db.raw(`
  create or replace view _sales as
  SELECT
    s.*,
    c.details AS "clientData",
    CASE
        WHEN "agnt2Id" IS NOT NULL THEN
          CONCAT(a.name, '(', "agntShare", '%) & ', a2.name, '(', "agnt2Share", '%)')
        WHEN "otherAgnt" IS NOT NULL THEN
          CONCAT(a.name, '(', "agntShare", '%) & ', "otherAgnt", '(', "agnt2Share", '%)')
        ELSE a.name
      END AS "agntName",
      ru.name AS "handlerName"
  FROM sales s
  LEFT JOIN clients c ON "clientId" = c.id
  LEFT JOIN users a ON "agntId" = a.id
  LEFT JOIN users a2 ON "agnt2Id" = a2.id
  LEFT JOIN users ru ON s."handlerId" = ru.id`)

  db.destroy()
}

run()
