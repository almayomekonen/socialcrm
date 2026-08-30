import dotenv from 'dotenv'
import { beforeAll } from 'vitest'

/**
 * Per-file test setup: process environment, plus cheap data isolation.
 *
 * The SCHEMA (baseline + migrations) is built ONCE per run in
 * `__tests__/globalSetup.ts`. It used to be rebuilt here, but `setupFiles` runs
 * per test FILE — so every one of ~470 files dropped and replayed the whole
 * migration chain, and concurrent files raced on DROP/CREATE SCHEMA.
 *
 * What files DO still need is a clean slate for their own fixtures, so this
 * truncates data before each file. That is milliseconds, against seconds for a
 * schema rebuild, and it keeps the isolation those tests were written against.
 *
 * DB-backed runs must be SERIALIZED (`--no-file-parallelism`, see the `test:db`
 * script): one shared database cannot give parallel files independent data,
 * whatever the reset strategy.
 */
dotenv.config({ path: '.env.test', override: true })

if (process.env.NODE_ENV !== 'test') {
  throw new Error(`[test setup] NODE_ENV must be 'test' (got '${process.env.NODE_ENV ?? 'undefined'}')`)
}

// Modules that reach the auth helpers at import time (server actions, and any
// component importing one) throw without this. A fixed, obviously-fake value —
// never a real secret, and only ever set when one is absent under NODE_ENV=test.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-not-a-real-secret'
process.env.SECRETS_ENC_KEY = process.env.SECRETS_ENC_KEY || Buffer.alloc(32, 7).toString('base64')

// The mobile signing key. `mobileKey()` throws below 32 chars, and this
// DELIBERATELY differs from JWT_SECRET — the production boot check treats an
// identical value as a misconfiguration, so the test environment must not model
// the very thing it forbids.
process.env.MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET || 'test-only-mobile-key-not-a-real-secret-xxxxxxxx'

// ── Per-file data isolation (skipped entirely when there is no database) ──────
if (process.env.VITEST_NO_DB !== '1') {
  beforeAll(async () => {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false })
    await client.connect()
    try {
      const { rows } = await client.query(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename <> ALL ($1::text[])`,
        [PRESERVED_TABLES],
      )
      if (rows.length) {
        const list = rows.map((r) => `public.${JSON.stringify(r.tablename)}`).join(', ')
        // CASCADE because the fixtures are a graph (agency → lead → conversation
        // → message); RESTART IDENTITY so sequence-derived ids are reproducible.
        await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
      }
    } finally {
      await client.end()
    }
  })
}

/**
 * Never truncated:
 *  - knex bookkeeping, or globalSetup's work would be undone and every file
 *    would try to re-run the migration chain;
 *  - `_migrations`, the legacy runner's bookkeeping, for the same reason;
 *  - `bill_tax_rates`, which is seeded by migration 20260513000001 and is
 *    schema-owned reference data, not a test fixture.
 */
const PRESERVED_TABLES = ['knex_migrations', 'knex_migrations_lock', '_migrations', 'bill_tax_rates']
