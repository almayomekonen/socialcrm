import { db } from '@/config/db'

async function main() {
  const hasSnooze = await db.schema.hasColumn('clients', 'snoozeUntil')
  if (hasSnooze) {
    console.log('snoozeUntil already exists — skipping')
  } else {
    await db.schema.table('clients', (t) => {
      t.timestamp('snoozeUntil').nullable().defaultTo(null)
    })
    console.log('Added snoozeUntil to clients')
  }

  const hasOutcome = await db.schema.hasColumn('clients', 'lastOutcomeType')
  if (hasOutcome) {
    console.log('lastOutcomeType already exists — skipping')
  } else {
    await db.schema.table('clients', (t) => {
      t.string('lastOutcomeType').nullable().defaultTo(null)
    })
    console.log('Added lastOutcomeType to clients')
  }
  await db.destroy()
}

main()
