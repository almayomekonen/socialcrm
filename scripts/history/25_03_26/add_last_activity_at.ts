import { db } from '@/config/db'

async function main() {
  const hasColumn = await db.schema.hasColumn('clients', 'lastActivityAt')
  if (hasColumn) {
    console.log('lastActivityAt column already exists — skipping')
    await db.destroy()
    return
  }

  await db.schema.alterTable('clients', (table) => {
    table.timestamp('lastActivityAt').nullable().defaultTo(null)
  })

  console.log('✅ Added lastActivityAt to clients table')
  await db.destroy()
}

main()
