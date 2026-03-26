import { db } from '@/config/db'

async function main() {
  const hasColumn = await db.schema.hasColumn('clients', 'lastActivityAt')
  if (hasColumn) {
    console.log('lastActivityAt already exists — skipping')
  } else {
    await db.schema.table('clients', (t) => {
      t.timestamp('lastActivityAt').nullable().defaultTo(null)
    })
    console.log('Added lastActivityAt to clients')
  }
  await db.destroy()
}

main()
