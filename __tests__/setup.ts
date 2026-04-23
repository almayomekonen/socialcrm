/**
 * Vitest global setup — runs ONCE per worker, before any test file.
 *
 * Responsibilities:
 *   1. Refuse to run unless NODE_ENV === 'test'.
 *   2. Refuse to run against anything that looks like a remote/prod DB.
 *   3. Drop and recreate the public schema, then run all migrations.
 *
 * Per-test data cleanup is the responsibility of each test file (afterEach).
 */
import knex from 'knex'
import path from 'path'

// 1. Environment guard
if (process.env.NODE_ENV !== 'test') {
  throw new Error(`[test setup] NODE_ENV must be 'test' (got '${process.env.NODE_ENV ?? 'undefined'}')`)
}

const url = process.env.DATABASE_URL ?? ''
if (!url) {
  throw new Error('[test setup] DATABASE_URL is not set — create .env.test (see .env.test.example)')
}

// 2. Safety guard — refuse anything that smells like a remote/prod DB.
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
if (hit) {
  throw new Error(`[test setup] DATABASE_URL contains forbidden pattern '${hit}'. Refusing to run.`)
}

// 3. Positive assertion — DB name must include "test" so a misconfigured local
//    URL pointing at the dev DB also fails fast.
let dbName = ''
try {
  dbName = new URL(url).pathname.replace(/^\//, '')
} catch {
  throw new Error('[test setup] DATABASE_URL is not a valid URL')
}
if (!dbName.toLowerCase().includes('test')) {
  throw new Error(
    `[test setup] DATABASE_URL database name '${dbName}' must include 'test'. ` +
      `Refusing to run to avoid wiping non-test data.`,
  )
}

// 4. Reset schema + run migrations
const k = knex({
  client: 'pg',
  connection: { connectionString: url, ssl: false },
  migrations: {
    directory: path.resolve(__dirname, '..', 'migrations'),
    extension: 'cjs',
  },
  pool: { min: 0, max: 5 },
})

await k.raw('DROP SCHEMA IF EXISTS public CASCADE')
await k.raw('CREATE SCHEMA public')
await k.migrate.latest()
await k.destroy()

console.log(`[test setup] schema reset + migrated on database '${dbName}'`)
