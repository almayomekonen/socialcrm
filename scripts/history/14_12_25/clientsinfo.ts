import { db } from "@/config/db"

async function run() {

   await db.schema.alterTable('clients_info', (table) => {
    table.jsonb('ipuyFiles').defaultTo('{}')
   })

  db.destroy()
}

run()
