import * as readline from 'readline'
import { execSync } from 'child_process'
import pg from 'pg'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ---------------------------------------------------------------------------
// Safety guard — refuse to run on production unless FORCE_RESET is set
// ---------------------------------------------------------------------------
const isProd =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production'

if (isProd && process.env.FORCE_RESET !== 'true') {
  console.error('\n🚨 BLOCKED: This script refuses to run in production.')
  console.error('   If you really mean it, set FORCE_RESET=true and re-run.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Tables to truncate — discovered from the actual DB schema.
// Order does not matter because we use CASCADE, but grouped for clarity.
//
// SKIPPED (system / migration tracking):
//   _migrations, knex_migrations, knex_migrations_lock
//
// SKIPPED (geographic reference data — needed by the app):
//   cities, streets
// ---------------------------------------------------------------------------
const TABLES = [
  // User-generated / business data
  'sale_users',
  'deleted_sales',
  'sales',
  'tasks',
  'task_tmplts',
  'files',
  'clients_info',
  'clients',
  'client_lists',
  'user_perms',
  'user_teams',
  'users_info',
  'default_settings',
  'invitations',
  'promo',
  'facebook_pages',
  'contract_prdcts',
  'contracts',
  'cmsn_rules',
  'tiny_urls',
  'requests',
  'qna',
  'teams',
  'users',
  'agencies',
  // Legacy insurance reference tables (cleared per reset intent)
  'bankim',
  'bit_prdcts',
  'bituchim',
  'halvaot',
  'neyarotErech',
  'savings',
]

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------
async function confirm(): Promise<void> {
  if (process.env.FORCE_RESET === 'true') {
    console.log('⚡ FORCE_RESET=true — skipping confirmation prompt.')
    return
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve, reject) => {
    console.log('\n⚠️  WARNING: This will delete ALL data in the database.')
    console.log('   Tables will be emptied and sequences reset to 1.')
    console.log('   Seed data will be re-inserted afterwards.\n')
    rl.question('   Type RESET to continue: ', (answer) => {
      rl.close()
      if (answer.trim() === 'RESET') {
        resolve()
      } else {
        reject(new Error('Aborted — you did not type RESET.'))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Main reset logic
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  await confirm()

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log('\n✅ Connected to database.')

    // Build a single TRUNCATE statement — PostgreSQL handles FK order with CASCADE
    const tableList = TABLES.map((t) => `"${t}"`).join(', ')
    const truncateSql = `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`

    console.log('\n⏳ Truncating all tables...')
    await client.query(truncateSql)
    console.log(`✅ Truncated ${TABLES.length} tables, sequences reset to 1.`)
  } finally {
    await client.end()
  }

  // ---------------------------------------------------------------------------
  // Run seeds
  // ---------------------------------------------------------------------------
  console.log('\n⏳ Running seed_all.ts...\n')
  execSync('npx tsx scripts/seeds/seed_all.ts', { stdio: 'inherit' })

  console.log('\n✅ Database reset complete. Clean seed data is now in place.')
}

run().catch((err) => {
  console.error('\n❌ Reset failed:', err.message)
  process.exit(1)
})
