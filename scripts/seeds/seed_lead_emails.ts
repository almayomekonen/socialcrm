import { db } from '../../config/db'

/**
 * One-off dev seeder: sets placeholder emails (name@example.com — RFC-reserved,
 * never deliverable) on 15 named TEST leads, scoped to one agency. Local DB only.
 * Re-runnable. Duplicate names get the same address on every matching row.
 */
const EMAIL = 'alamayo274@gmail.com'

const SEED: { firstName: string; lastName: string; email: string }[] = [
  { firstName: 'דור', lastName: 'כהן', email: 'dor.cohen@example.com' },
  { firstName: 'אסף', lastName: 'אזולאי', email: 'asaf.azoulay@example.com' },
  { firstName: 'חן', lastName: 'כהן', email: 'chen.cohen@example.com' },
  { firstName: 'עדי', lastName: 'דהן', email: 'adi.dahan@example.com' },
  { firstName: 'עידן', lastName: 'עמר', email: 'idan.amar@example.com' },
  { firstName: 'עומר', lastName: 'מזרחי', email: 'omer.mizrahi@example.com' },
  { firstName: 'ניר', lastName: 'מזרחי', email: 'nir.mizrahi@example.com' },
  { firstName: 'חן', lastName: 'גבאי', email: 'chen.gabay@example.com' },
  { firstName: 'יוסי', lastName: 'עמר', email: 'yossi.amar@example.com' },
  { firstName: 'ספיר', lastName: 'ביטון', email: 'sapir.biton@example.com' },
  { firstName: 'דנה', lastName: 'כהן', email: 'dana.cohen@example.com' },
  { firstName: 'בר', lastName: 'כהן', email: 'bar.cohen@example.com' },
  { firstName: 'שירה', lastName: 'לוי', email: 'shira.levy@example.com' },
  { firstName: 'ספיר', lastName: 'דהן', email: 'sapir.dahan@example.com' },
  { firstName: 'רון', lastName: 'דהן', email: 'ron.dahan@example.com' },
]

async function run() {
  const dbUrl = (process.env.DATABASE_URL ?? '').replace(/:\/\/[^@]*@/, '://***@')
  if (!dbUrl.includes('localhost')) {
    console.error(`❌ refusing to run against non-local DB: ${dbUrl}`)
    await db.destroy()
    process.exit(1)
  }
  console.log('DB:', dbUrl)

  const user = await db('users').where({ email: EMAIL }).first()
  if (!user) {
    console.error(`❌ user ${EMAIL} not found`)
    await db.destroy()
    process.exit(1)
  }
  console.log(`agencyId=${user.agencyId}\n`)

  let updated = 0
  await db.transaction(async (trx) => {
    for (const s of SEED) {
      const rows = await trx('clients')
        .where({ agencyId: user.agencyId, firstName: s.firstName, lastName: s.lastName })
        .select('id', 'email')
      if (rows.length === 0) {
        console.log(`  ⚠️  ${s.firstName} ${s.lastName} — no match, skipped`)
        continue
      }
      await trx('clients')
        .where({ agencyId: user.agencyId, firstName: s.firstName, lastName: s.lastName })
        .update({ email: s.email, updatedAt: new Date() })
      updated += rows.length
      const ids = rows.map((r) => `${r.id}${r.email ? ` (was: ${r.email})` : ''}`).join(', ')
      console.log(`  ✅ ${`${s.firstName} ${s.lastName}`.padEnd(14)} → ${s.email.padEnd(26)} [${ids}]`)
    }
  })

  console.log(`\nDone. ${updated} lead row(s) across ${SEED.length} names now have emails.`)
  await db.destroy()
}

run().catch(async (e) => {
  console.error(e)
  await db.destroy()
  process.exit(1)
})
