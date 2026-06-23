/**
 * Create a standalone DEMO account on production so an external tester can log
 * in and explore a fully-populated app.
 *
 * It mirrors actions/agencies.ts → addAgency EXACTLY (agency → ADMIN user →
 * users_info → default_settings) so the account is created the same way the app
 * creates real ones — no hand-rolled auth state. The only deliberate extra is
 * setting the demo agency trialExempt=true so the tester never hits the paywall.
 *
 * SAFETY: same guards as seed_prod_demo.ts — explicit prod URL from
 * .env.production.local, masked host print, refuses to write without
 * SEED_CONFIRM=YES, and SEED_DRY=1 verifies connection without writing.
 *
 * After this succeeds, seed the data into the new agency:
 *   SEED_TARGET_EMAIL=<email> SEED_CONFIRM=YES npx tsx scripts/seeds/seed_prod_demo.ts
 *
 * USAGE
 *   DEMO_EMAIL=yuton@gmail.com DEMO_NAME=Yuton SEED_CONFIRM=YES \
 *     npx tsx scripts/seeds/create_demo_user.ts
 */
import knex from 'knex'
import dotenv from 'dotenv'

const DEMO_EMAIL = (process.env.DEMO_EMAIL || '').trim().toLowerCase()
const DEMO_FIRST = process.env.DEMO_NAME || 'Demo'
const DEMO_LAST = process.env.DEMO_LAST || ''
const AGENCY_NAME = process.env.DEMO_AGENCY || `Demo — ${DEMO_FIRST}`

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(DEMO_EMAIL)) {
  console.error(`❌ DEMO_EMAIL is missing or invalid: "${DEMO_EMAIL}"`)
  process.exit(1)
}

const prodEnv = dotenv.config({ path: '.env.production.local' }).parsed ?? {}
const rawUrl = process.env.SEED_DATABASE_URL || prodEnv.DATABASE_URL || ''
if (!rawUrl) {
  console.error('❌ No prod DATABASE_URL found (.env.production.local). Aborting.')
  process.exit(1)
}
const url = new URL(rawUrl)
const sslMode = url.searchParams.get('sslmode') ?? 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)
url.searchParams.delete('sslmode')

console.log(`\n🎯 Target DB host: ${url.hostname}  (ssl=${useSSL})`)
console.log(`   demo email: ${DEMO_EMAIL}  |  agency: ${AGENCY_NAME}`)
if (process.env.SEED_CONFIRM !== 'YES') {
  console.error('\n⛔ Refusing to write. Re-run with SEED_CONFIRM=YES.')
  process.exit(1)
}

const db = knex({
  client: 'pg',
  connection: { connectionString: url.toString(), ssl: useSSL ? { rejectUnauthorized: false } : false },
  pool: { min: 0, max: 4 },
})

async function run() {
  const existing = await db('users').where({ email: DEMO_EMAIL }).first()
  if (existing) {
    console.log(`\n⚠ User already exists: id=${existing.id}, agencyId=${existing.agencyId}. Nothing to create.`)
    console.log(`   To seed data into this agency:`)
    console.log(`   SEED_TARGET_EMAIL=${DEMO_EMAIL} SEED_CONFIRM=YES npx tsx scripts/seeds/seed_prod_demo.ts`)
    await db.destroy()
    return
  }

  if (process.env.SEED_DRY === '1') {
    console.log('\n🧪 DRY RUN — connection verified, user does not exist yet. No rows written.')
    await db.destroy()
    return
  }

  let agencyId: number | null = null
  let userId: number | null = null
  await db.transaction(async (trx) => {
    const [agency] = await trx('agencies').insert({ name: AGENCY_NAME }).returning('id')
    agencyId = agency.id
    // Demo bypass: exempt from the trial paywall so the tester isn't gated.
    await trx('agencies').where({ id: agencyId }).update({ trialExempt: true })

    const [user] = await trx('users')
      .insert({ firstName: DEMO_FIRST, lastName: DEMO_LAST || null, email: DEMO_EMAIL, agencyId, role: 'ADMIN' })
      .returning('*')
    userId = user.id
    await trx('users_info').insert({ id: user.id }).onConflict('id').merge()
    await trx('default_settings').insert({ userId: user.id })
  })

  console.log(`\n✅ Created demo account:`)
  console.log(`   user id:    ${userId}`)
  console.log(`   agency id:  ${agencyId}  (trialExempt=true)`)
  console.log(`   email:      ${DEMO_EMAIL}  role=ADMIN`)
  console.log(`\nNext — seed data into this agency:`)
  console.log(`   SEED_TARGET_EMAIL=${DEMO_EMAIL} SEED_CONFIRM=YES npx tsx scripts/seeds/seed_prod_demo.ts`)
  console.log(`\nTo remove later:`)
  console.log(`   SEED_AGENCY_ID=${agencyId} SEED_CONFIRM=YES npx tsx scripts/seeds/cleanup_prod_demo.ts`)
  console.log(`   (then delete the user + agency rows for ${DEMO_EMAIL})`)
  await db.destroy()
}

run().catch(async (e) => {
  console.error('Fatal:', e.message)
  await db.destroy()
  process.exit(1)
})
