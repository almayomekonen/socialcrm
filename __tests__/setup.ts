import knex from 'knex'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.test', override: true })

if (process.env.NODE_ENV !== 'test') {
  throw new Error(`[test setup] NODE_ENV must be 'test' (got '${process.env.NODE_ENV ?? 'undefined'}')`)
}

if (process.env.VITEST_NO_DB === '1') {
  console.log('[test setup] VITEST_NO_DB=1 → skipping schema reset + migrations')
} else {
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
  await k.migrate.latest()
  await k.destroy()

  console.log(`[test setup] schema reset + migrated on database '${dbName}'`)
}
