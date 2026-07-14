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

const k = knex({ client: 'pg', connection: { connectionString, ssl: false }, pool: { min: 0, max: 5 } })
await shadowCoverage.down(k)
await shadowDecisions.down(k)
await stateManagement.down(k)
await stateManagement.up(k)
await shadowDecisions.up(k)
await shadowCoverage.up(k)
await k.destroy()

console.log(`[runtime test setup] M1 + shadow ai_* tables re-created on database '${dbName}'`)
