/**
 * Schema bootstrap — the safety boundary and the baseline↔chain contract.
 *
 * Bootstrap creates 91 tables. Pointed at the wrong database it would be a
 * catastrophe, so the refusal rules are asserted individually here, without a
 * database, and the baseline artifacts are checked for the properties the
 * loader depends on.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const boot = require('../../scripts/bootstrap-schema.cjs') as typeof import('../../scripts/bootstrap-schema.cjs')
const { assertUrlEligible, assertDatabaseEmpty, readBaseline, RefusedError } = boot

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'migrations')
const manifest = JSON.parse(readFileSync(join(ROOT, 'db', 'baseline', 'baseline.json'), 'utf8'))

const refusal = (fn: () => unknown): InstanceType<typeof RefusedError> => {
  try {
    fn()
  } catch (e) {
    return e as InstanceType<typeof RefusedError>
  }
  throw new Error('expected a refusal, but the call succeeded')
}

describe('bootstrap refuses ineligible targets', () => {
  it('refuses a missing URL', () => {
    expect(refusal(() => assertUrlEligible(undefined, {})).reason).toMatch(/DATABASE_URL is not set/)
  })

  it('refuses every hosted-provider pattern', () => {
    // The list is the same one __tests__/globalSetup.ts enforces. If a provider
    // is ever added there it must be added here too.
    for (const host of ['neon.tech', 'rds.amazonaws.com', 'supabase.co', 'railway.app', 'fly.io']) {
      const r = refusal(() => assertUrlEligible(`postgres://u:p@db.${host}:5432/socialcrm_test`, {}))
      expect(r.reason, host).toMatch(/forbidden hosted-provider pattern/)
    }
    // …and a URL that merely says "production" anywhere.
    expect(refusal(() => assertUrlEligible('postgres://u:p@localhost:5432/production_test', {})).reason).toMatch(
      /forbidden hosted-provider pattern/,
    )
  })

  it('refuses a remote host unless explicitly allowed', () => {
    expect(refusal(() => assertUrlEligible('postgres://u:p@10.0.0.9:5432/socialcrm_test', {})).reason).toMatch(
      /is not local/,
    )
    // CI runs against a disposable service container, which is remote by nature.
    expect(() =>
      assertUrlEligible('postgres://u:p@10.0.0.9:5432/socialcrm_test', { BOOTSTRAP_ALLOW_REMOTE: '1' }),
    ).not.toThrow()
  })

  it('refuses a database that does not look like a test database', () => {
    // This is what stands between a careless run and the developer's real
    // `socialcrm` database.
    const r = refusal(() => assertUrlEligible('postgres://u:p@localhost:5432/socialcrm', {}))
    expect(r.reason).toMatch(/does not look like a test database/)
    expect(r.detail).toMatch(/BOOTSTRAP_CONFIRM_DB=socialcrm/)
  })

  it('accepts an exact confirmation for a non-test local database', () => {
    expect(() =>
      assertUrlEligible('postgres://u:p@localhost:5432/socialcrm', { BOOTSTRAP_CONFIRM_DB: 'socialcrm' }),
    ).not.toThrow()
    // …but only for the database actually named.
    expect(
      refusal(() => assertUrlEligible('postgres://u:p@localhost:5432/socialcrm', { BOOTSTRAP_CONFIRM_DB: 'other' }))
        .reason,
    ).toMatch(/does not look like a test database/)
  })

  it('accepts a local test database', () => {
    expect(() => assertUrlEligible('postgres://u:p@localhost:5432/socialcrm_test', {})).not.toThrow()
  })

  it('refuses a database that already contains tables', async () => {
    // The rule that actually protects data: emptiness, not naming.
    const fakeClient = { query: async () => ({ rows: [{ tablename: 'clients' }, { tablename: 'agencies' }] }) }
    await expect(assertDatabaseEmpty(fakeClient as never, 'socialcrm_test')).rejects.toThrow(
      /already contains 2 table\(s\)/,
    )
  })

  it('accepts an empty database', async () => {
    const fakeClient = { query: async () => ({ rows: [] }) }
    await expect(assertDatabaseEmpty(fakeClient as never, 'socialcrm_test')).resolves.toBeUndefined()
  })
})

describe('the baseline artifact', () => {
  it('carries schema but no data', () => {
    const { sql } = readBaseline()
    expect(sql).toMatch(/^CREATE TABLE/m)
    // Anchored at column 0: pg_dump writes data at the top level, while the
    // INSERTs inside trigger function bodies are indented.
    expect(sql).not.toMatch(/^COPY .* FROM stdin;/m)
    expect(sql).not.toMatch(/^INSERT INTO /m)
  })

  it('has no psql-only directives the driver cannot execute', () => {
    // pg_dump 17+ brackets its output with \restrict / \unrestrict, which fail
    // through a driver as a bare "syntax error at or near \".
    expect(readBaseline().sql).not.toMatch(/^\\(un)?restrict\s/m)
  })

  it('does not create schema public, which already exists on a fresh database', () => {
    expect(readBaseline().sql).not.toMatch(/CREATE SCHEMA public/)
  })

  it('contains the base tables the knex chain assumes but never creates', () => {
    const { sql } = readBaseline()
    for (const t of ['clients', 'agencies', 'tasks', 'user_perms', 'sale_users', 'users']) {
      expect(sql, `baseline is missing ${t}`).toMatch(new RegExp(`CREATE TABLE public\\.${t}\\b`))
    }
  })
})

describe('the baseline ↔ migration-chain contract', () => {
  const onDisk = (): string[] =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs').readdirSync(MIGRATIONS_DIR) as string[]).filter((f) => f.endsWith('.cjs')).sort()

  it('stamps only migrations that still exist on disk', () => {
    // Knex refuses to run when a recorded migration is missing from the
    // directory, so a stale stamp entry would break every fresh database.
    const missing = manifest.stampedMigrations.filter((n: string) => !onDisk().includes(n))
    expect(missing, `stamped but absent: ${missing.join(', ')}`).toEqual([])
  })

  it('leaves every migration newer than the baseline to actually run', () => {
    // This is the whole point: new migrations execute against a real schema.
    // If this list were ever empty the harness would stop proving anything.
    const pending = onDisk().filter((n) => !manifest.stampedMigrations.includes(n))
    expect(pending.length).toBeGreaterThan(0)
  })

  it('stamps the 20240101000000 users stub so it can never create its wrong table', () => {
    // The stub creates a 5-column `users`; production's has 25. It is neutralized
    // by being stamped — the baseline supplies the real table — rather than by
    // editing an already-applied migration.
    expect(manifest.stampedMigrations).toContain('20240101000000_create_users.cjs')
    expect(readBaseline().sql).toMatch(/CREATE TABLE public\.users/)
  })

  it('records where it came from', () => {
    expect(manifest.sourceDatabase).toBeTruthy()
    expect(manifest.pgDumpVersion).toMatch(/pg_dump/)
    expect(manifest.stampedMigrationCount).toBe(manifest.stampedMigrations.length)
  })
})
