import knex from 'knex'
import path from 'path'
import dotenv from 'dotenv'

/**
 * Vitest globalSetup — runs ONCE per test run, before any test file.
 *
 * Builds the test database from the captured schema baseline and then advances
 * it with the knex migration chain. This is the step that makes DB-backed tests
 * possible at all: the chain cannot build a database from zero (21 of the 25
 * tables the app queries predate knex and are created by nothing in this repo),
 * so without a baseline `migrate.latest()` dies on `relation "clients" does not
 * exist`.
 *
 * WHY GLOBAL, NOT PER-FILE. This used to live in setupFiles, which vitest runs
 * once per test FILE. That meant ~470 schema rebuilds per run, and concurrent
 * files raced each other on DROP/CREATE SCHEMA. Once per run is both correct and
 * ~470x cheaper. Files no longer get a pristine database each; DB-backed tests
 * own their fixtures, as they already did within a file.
 *
 * See scripts/bootstrap-schema.cjs and
 * claude/research/engineering/migration-chain-drift-decision.md.
 */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: '.env.test', override: true })

  if (process.env.NODE_ENV !== 'test') {
    throw new Error(`[test setup] NODE_ENV must be 'test' (got '${process.env.NODE_ENV ?? 'undefined'}')`)
  }
  if (process.env.VITEST_NO_DB === '1') {
    console.log('[test setup] VITEST_NO_DB=1 → skipping schema reset + migrations')
    return
  }

  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    throw new Error('Test environment requires DATABASE_URL')
  }

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

  // ── Schema baseline ────────────────────────────────────────────────────────
  // The knex chain cannot build a database from zero: 21 of the 25 tables the
  // app queries (clients, agencies, tasks, user_perms, the views…) are created
  // by nothing in this repository — they predate knex, which was retrofitted in
  // 2026-03 onto an already-existing database. Without this step `migrate.latest()`
  // dies immediately on `relation "clients" does not exist`, which is why every
  // DB-backed test in this repo has been unrunnable.
  //
  // Bootstrap loads the captured baseline and stamps the migrations the baseline
  // already contains, so `migrate.latest()` below applies only what came after —
  // against a REAL schema. That is what makes a SQL-level defect (a missing CHECK
  // value, a bad FK) fail here instead of in production.
  //
  // See scripts/bootstrap-schema.cjs and
  // claude/research/engineering/migration-chain-drift-decision.md.
  const { Client } = await import('pg')
  const bootstrapModule = await import('../scripts/bootstrap-schema.cjs')
  const { bootstrap, readBaseline, assertDatabaseEmpty } = (bootstrapModule.default ??
    bootstrapModule) as typeof import('../scripts/bootstrap-schema.cjs')

  const client = new Client({ connectionString: url, ssl: false })
  await client.connect()
  try {
    // The schema was just dropped and recreated, so this passes — it is here so
    // a future change to the reset above cannot silently bootstrap over data.
    await assertDatabaseEmpty(client, dbName)
    await bootstrap(client, readBaseline())
  } finally {
    await client.end()
  }

  await k.migrate.latest()
  await k.destroy()

  console.log(`[test setup] baseline + migrations applied on database '${dbName}'`)
}
