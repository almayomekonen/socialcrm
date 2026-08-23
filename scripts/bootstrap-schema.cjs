#!/usr/bin/env node
/**
 * Fresh-database bootstrap: load the schema baseline, then stamp the migrations
 * the baseline already contains so `knex migrate:latest` applies only what came
 * after it.
 *
 * WHY THIS IS NOT A KNEX MIGRATION. A migration cannot safely stamp its own
 * siblings: knex owns the `knex_migrations` table for the duration of a run, and
 * a migration that inserted 82 rows into it mid-run would be fighting the tool
 * for control of its own bookkeeping. Bootstrap is therefore a separate step
 * that finishes completely before knex is invoked at all.
 *
 * WHY A BASELINE EXISTS AT ALL. This repository's knex chain was retrofitted in
 * 2026-03 onto a database that already existed — first built by Prisma
 * (2024-07 → 2025-01), then hand-edited for ~14 months with no migration system.
 * 21 of the 25 tables the application queries are created by nothing in this
 * repository. The chain has therefore never been able to build a database from
 * zero, and was never designed to. The baseline is the missing starting point.
 * See claude/research/engineering/migration-chain-drift-decision.md.
 *
 * WHAT THIS IS NOT. The baseline is not migration history and carries no
 * authority over it. It is a snapshot of where the chain starts. Everything
 * after it is owned by knex, in `migrations/`, forever.
 *
 * SAFETY. This creates 91 tables. Pointed at the wrong database it would be a
 * catastrophe, so it refuses by default and explains every refusal:
 *   1. the URL must not match a known hosted-provider pattern;
 *   2. the host must be local, unless BOOTSTRAP_ALLOW_REMOTE=1;
 *   3. the database name must contain "test", unless BOOTSTRAP_CONFIRM_DB
 *      exactly names the target database;
 *   4. the target must contain ZERO tables in `public`.
 * Rules 1–3 mirror the guards __tests__/setup.ts already enforces. Rule 4 is the
 * real protection: a database with anything in it is never touched.
 *
 * Usage:  node scripts/bootstrap-schema.cjs [--url <postgres-url>]
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const BASELINE_DIR = path.join(__dirname, '..', 'db', 'baseline')
const SCHEMA_FILE = path.join(BASELINE_DIR, 'schema-baseline.sql')
const MANIFEST_FILE = path.join(BASELINE_DIR, 'baseline.json')

/** Hosted providers — a bootstrap must never point at one. Mirrors __tests__/setup.ts. */
const DANGEROUS = [
  'railway.app', 'vercel-storage.com', 'rds.amazonaws.com', 'azure.com',
  'supabase.co', 'supabase.com', 'neon.tech', 'planetscale.com',
  'render.com', 'digitalocean.com', 'fly.io', 'production', '/prod', '_prod',
]

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'postgres', 'db'])

class RefusedError extends Error {
  constructor(reason, detail) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

/**
 * Every eligibility rule that can be judged from the URL alone. Pure and
 * exported so the test suite can assert each refusal without a database.
 *
 * @param {string | undefined} rawUrl
 * @param {Record<string, string | undefined>} [env] Overridable so tests can
 *   exercise each rule without mutating the real process environment.
 */
function assertUrlEligible(rawUrl, env = process.env) {
  if (!rawUrl) throw new RefusedError('DATABASE_URL is not set', 'Pass --url or set DATABASE_URL.')

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new RefusedError('DATABASE_URL is not a valid URL', String(rawUrl).slice(0, 40))
  }

  const lowered = rawUrl.toLowerCase()
  const hit = DANGEROUS.find((p) => lowered.includes(p))
  if (hit) {
    throw new RefusedError(
      `the connection string matches a forbidden hosted-provider pattern ('${hit}')`,
      'Bootstrap creates tables. It must never run against a hosted or production database.',
    )
  }

  if (!LOCAL_HOSTS.has(url.hostname) && env.BOOTSTRAP_ALLOW_REMOTE !== '1') {
    throw new RefusedError(
      `host '${url.hostname}' is not local`,
      'Set BOOTSTRAP_ALLOW_REMOTE=1 only for a disposable CI database you control.',
    )
  }

  const dbName = url.pathname.replace(/^\//, '')
  if (!dbName) throw new RefusedError('the connection string names no database', rawUrl.slice(0, 40))

  if (!dbName.toLowerCase().includes('test') && env.BOOTSTRAP_CONFIRM_DB !== dbName) {
    throw new RefusedError(
      `database '${dbName}' does not look like a test database`,
      `Re-run with BOOTSTRAP_CONFIRM_DB=${dbName} to confirm you mean this exact database.`,
    )
  }

  return { url, dbName }
}

/** The target must be completely empty. This is the rule that actually protects data. */
async function assertDatabaseEmpty(client, dbName) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )
  if (rows.length === 0) return
  const names = rows.map((r) => r.tablename)
  throw new RefusedError(
    `database '${dbName}' already contains ${names.length} table(s) in schema "public"`,
    `Bootstrap only ever runs on an empty database. Found: ${names.slice(0, 8).join(', ')}` +
      (names.length > 8 ? `, … (+${names.length - 8} more)` : '') +
      '\n  To rebuild it: DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
  )
}

function readBaseline() {
  for (const f of [SCHEMA_FILE, MANIFEST_FILE]) {
    if (!fs.existsSync(f)) {
      throw new RefusedError(
        `baseline artifact missing: ${path.relative(process.cwd(), f)}`,
        'Regenerate it — see db/baseline/README.md.',
      )
    }
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  const stamped = manifest.stampedMigrations
  if (!Array.isArray(stamped) || stamped.length === 0) {
    throw new RefusedError('baseline.json lists no stamped migrations', 'The manifest is malformed.')
  }
  // pg_dump 17+ wraps its output in psql-only `\restrict` / `\unrestrict`
  // guards. The generator strips them (see db/baseline/README.md), but a dump
  // regenerated without that step would otherwise fail here with a bare
  // "syntax error at or near \", which says nothing about the cause. Narrow on
  // purpose: only those two directives, never any line that merely starts with
  // a backslash, which could be a legitimate line inside a function body.
  const sql = fs
    .readFileSync(SCHEMA_FILE, 'utf8')
    .split('\n')
    .filter((line) => !/^\\(un)?restrict\s/.test(line))
    .join('\n')
  return { sql, manifest, stamped }
}

/**
 * Load the baseline and stamp, in ONE transaction. A half-bootstrapped database
 * would be worse than none: it would fail rule 4 forever after and could not be
 * retried without a manual drop.
 */
async function bootstrap(client, { sql, stamped }) {
  await client.query('BEGIN')
  try {
    await client.query(sql)

    // pg_dump hardens its output with `SELECT set_config('search_path', '', false)`
    // and schema-qualifies every object. That empty search_path is still in
    // effect for the rest of this session, so our own statements below must be
    // qualified too — otherwise they fail with "no schema has been selected to
    // create in", an error that points nowhere near the cause.
    await client.query('SET search_path TO public')

    // The dump is schema-only, so knex's bookkeeping tables arrive empty and we
    // fill them. Created defensively in case a future baseline excludes them.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.knex_migrations (
        id serial PRIMARY KEY, name varchar(255), batch integer, migration_time timestamptz
      );
      CREATE TABLE IF NOT EXISTS public.knex_migrations_lock (index serial PRIMARY KEY, is_locked integer);`)

    const already = await client.query('SELECT count(*)::int AS n FROM public.knex_migrations')
    if (already.rows[0].n > 0) {
      throw new RefusedError(
        'knex_migrations already has rows after loading the baseline',
        'The baseline dump must be schema-only. Regenerate it with --schema-only.',
      )
    }

    // batch 1 = "everything the baseline already contains".
    await client.query(
      `INSERT INTO public.knex_migrations (name, batch, migration_time)
       SELECT unnest($1::text[]), 1, now()`,
      [stamped],
    )
    const lock = await client.query('SELECT count(*)::int AS n FROM public.knex_migrations_lock')
    if (lock.rows[0].n === 0) await client.query('INSERT INTO public.knex_migrations_lock (is_locked) VALUES (0)')

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

async function run(argv = process.argv, env = process.env) {
  const urlFlag = argv.indexOf('--url')
  const rawUrl = urlFlag > -1 ? argv[urlFlag + 1] : env.DATABASE_URL

  const { url, dbName } = assertUrlEligible(rawUrl, env)
  const { sql, manifest, stamped } = readBaseline()

  url.searchParams.delete('sslmode')
  const client = new Client({ connectionString: url.toString(), ssl: false })
  await client.connect()
  try {
    await assertDatabaseEmpty(client, dbName)
    console.log(`[bootstrap] target ${url.hostname}:${url.port}/${dbName} — empty, eligible`)
    console.log(`[bootstrap] baseline ${manifest.generatedAt} from ${manifest.sourceDatabase}`)
    await bootstrap(client, { sql, stamped })
    const t = await client.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`)
    console.log(`[bootstrap] loaded ${t.rows[0].n} tables, stamped ${stamped.length} migrations`)
    console.log('[bootstrap] done — run `npm run migrate` to apply everything after the baseline')
  } finally {
    await client.end()
  }
}

module.exports = { run, bootstrap, assertUrlEligible, assertDatabaseEmpty, readBaseline, RefusedError, DANGEROUS }

if (require.main === module) {
  run().catch((err) => {
    if (err instanceof RefusedError) {
      console.error(`\n[bootstrap] REFUSED: ${err.reason}`)
      if (err.detail) console.error(`  ${err.detail}`)
      console.error('')
    } else {
      console.error('[bootstrap] FAILED:', err.message)
    }
    process.exit(1)
  })
}
