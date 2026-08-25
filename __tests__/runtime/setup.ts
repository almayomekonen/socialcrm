import knex from 'knex'
import dotenv from 'dotenv'
import { createRequire } from 'module'

dotenv.config({ path: '.env.test', override: true })

if (process.env.NODE_ENV !== 'test') {
  throw new Error(`[runtime test setup] NODE_ENV must be 'test' (got '${process.env.NODE_ENV ?? 'undefined'}')`)
}

const url = process.env.DATABASE_URL ?? ''
if (!url) throw new Error('[runtime test setup] Test environment requires DATABASE_URL')

const DANGEROUS = [
  'railway.app',
  'vercel-storage.com',
  'rds.amazonaws.com',
  'azure.com',
  'supabase.co',
  'supabase.com',
  'neon.tech',
  'planetscale.com',
  'render.com',
  'digitalocean.com',
  'fly.io',
  'production',
  '/prod',
  '_prod',
]
const lowered = url.toLowerCase()
const hit = DANGEROUS.find((p) => lowered.includes(p))
if (hit) throw new Error(`[runtime test setup] DATABASE_URL contains forbidden pattern '${hit}'. Refusing to run.`)

let dbName = ''
try {
  dbName = new URL(url).pathname.replace(/^\//, '')
} catch {
  throw new Error('[runtime test setup] DATABASE_URL is not a valid URL')
}
if (!dbName.toLowerCase().includes('test')) {
  throw new Error(`[runtime test setup] DATABASE_URL database name '${dbName}' must include 'test'. Refusing to run.`)
}

const connectionString = (() => {
  const u = new URL(url)
  u.searchParams.delete('sslmode')
  return u.toString()
})()

const require = createRequire(import.meta.url)
type Migration = { up: (k: import('knex').Knex) => Promise<void>; down: (k: import('knex').Knex) => Promise<void> }
const stateManagement = require('../../migrations/20260713000001_create_ai_state_management.cjs') as Migration
const shadowDecisions = require('../../migrations/20260714000001_create_ai_shadow_decisions.cjs') as Migration
const shadowCoverage = require('../../migrations/20260714000002_create_ai_shadow_coverage.cjs') as Migration
// Phase-1: widens ai_shadow_coverage.reason to admit 'absence'. It ALTERs the
// table shadowCoverage.up just created, so it must follow it in the chain.
const coverageAbsenceReason = require('../../migrations/20260825000001_ai_shadow_coverage_absence_reason.cjs') as Migration
// Phase-2: the durable signal lease queue. Independent of the ai_* tables above,
// so it is torn down and rebuilt on its own.
const signalJobs = require('../../migrations/20260825000002_create_signal_jobs.cjs') as Migration
// Phase-4.2: the durable autonomous spend ledger. Independent of every table
// above — it references signal_jobs by id but carries no foreign key, so it is
// torn down and rebuilt on its own like signal_jobs.
const spendReservations = require('../../migrations/20260825000003_create_ai_spend_reservations.cjs') as Migration
// Phase-4.3 / 4.4: the run record and the conclusion record. Both isolated.
const investigations = require('../../migrations/20260825000004_create_ai_investigations.cjs') as Migration
const insights = require('../../migrations/20260825000005_create_ai_insights.cjs') as Migration

const k = knex({ client: 'pg', connection: { connectionString, ssl: false }, pool: { min: 0, max: 5 } })
await shadowCoverage.down(k)
await shadowDecisions.down(k)
await stateManagement.down(k)
await stateManagement.up(k)
await shadowDecisions.up(k)
await shadowCoverage.up(k)
await coverageAbsenceReason.up(k)
await signalJobs.down(k)
await signalJobs.up(k)
await spendReservations.down(k)
await spendReservations.up(k)
await investigations.down(k)
await investigations.up(k)
await insights.down(k)
await insights.up(k)
await k.destroy()

console.log(
  `[runtime test setup] M1 + shadow ai_* + signal_jobs + ai_spend_reservations + ai_investigations + ai_insights re-created on database '${dbName}'`,
)
