/**
 * Generate a working magic-login link for a demo/test account WITHOUT needing
 * access to that account's inbox.
 *
 * It writes a valid OTP to the user's row exactly the way actions/auth.ts →
 * sendToken does (same { token, tokenExpiry } shape that app/api/magic checks),
 * then prints the URL. Open the URL in a browser → logged in → /dashboard.
 *
 * NOTE: the link is SINGLE-USE (the magic route clears the OTP on success) but
 * the resulting session cookie lasts ~2 days and auto-refreshes. Re-run this to
 * mint a fresh link anytime.
 *
 * SAFETY: explicit prod URL from .env.production.local, masked host, refuses to
 * write without SEED_CONFIRM=YES.
 *
 * USAGE
 *   DEMO_EMAIL=yuton@gmail.com SEED_CONFIRM=YES npx tsx scripts/seeds/magic_link.ts
 */
import knex from 'knex'
import dotenv from 'dotenv'

const DEMO_EMAIL = (process.env.DEMO_EMAIL || 'yuton@gmail.com').trim().toLowerCase()
const APP_BASE = (process.env.APP_BASE || 'https://getsocialcrm.com').replace(/\/$/, '')
const EXPIRY_DAYS = Number(process.env.EXPIRY_DAYS || 7)

const prodEnv = dotenv.config({ path: '.env.production.local' }).parsed ?? {}
const rawUrl = process.env.SEED_DATABASE_URL || prodEnv.DATABASE_URL || ''
if (!rawUrl) {
  console.error('❌ No prod DATABASE_URL found (.env.production.local). Aborting.')
  process.exit(1)
}
const url = new URL(rawUrl)
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? 'disable')
url.searchParams.delete('sslmode')

console.log(`\n🎯 Target DB host: ${url.hostname}  |  email: ${DEMO_EMAIL}`)
if (process.env.SEED_CONFIRM !== 'YES') {
  console.error('\n⛔ Refusing to write. Re-run with SEED_CONFIRM=YES.')
  process.exit(1)
}

const db = knex({
  client: 'pg',
  connection: { connectionString: url.toString(), ssl: useSSL ? { rejectUnauthorized: false } : false },
  pool: { min: 0, max: 3 },
})

// Same generator as lib/funcs.ts genToken — inlined to avoid importing modules
// that would force-load the localhost db singleton.
function genToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

async function run() {
  const user = await db('users').where({ email: DEMO_EMAIL }).first()
  if (!user) {
    console.error(`❌ User not found: ${DEMO_EMAIL}`)
    await db.destroy()
    process.exit(1)
  }
  if (user.suspended) {
    console.error(`❌ User is suspended — magic login would be rejected.`)
    await db.destroy()
    process.exit(1)
  }

  const token = genToken()
  // Date (not ISO string) to match the users.otp column type; knex serializes
  // it to JSON, and /api/magic parses it back with new Date(...).
  const tokenExpiry = new Date(Date.now() + EXPIRY_DAYS * 864e5)
  await db('users').where({ id: user.id }).update({ otp: { token, tokenExpiry } })

  const link = `${APP_BASE}/api/magic?token=${token}&email=${encodeURIComponent(DEMO_EMAIL)}`
  console.log(`\n✅ Magic login link (valid ${EXPIRY_DAYS} days, single use):\n`)
  console.log(link)
  console.log(`\nSend this to the tester. Opening it logs them straight into /dashboard.\n`)
  await db.destroy()
}

run().catch(async (e) => {
  console.error('Fatal:', e.message)
  await db.destroy()
  process.exit(1)
})
