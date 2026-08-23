/**
 * LEGACY RUNNER — NOT the authoritative migration system. Do not add to it.
 *
 * Knex owns the schema from the baseline forward (`migrations/*.cjs`, tracked in
 * `knex_migrations`). This runner predates it, reads `db/migrations/*.sql`, and
 * tracks its work in a separate `_migrations` table.
 *
 * RETAINED DELIBERATELY, NOT BECAUSE IT IS USED. Evidence gathered 2026-08-23:
 *   · `_migrations` exists in the development database with ZERO rows, and does
 *     not exist at all in the test database — this runner has never successfully
 *     applied anything in either;
 *   · both tables its two `.sql` files create (`facebook_pages`,
 *     `whatsapp_connections`) are present in the schema baseline, so a fresh
 *     database does not need it;
 *   · `20260328000001_create_whatsapp_connections.cjs` already guards with
 *     `hasTable(...)` precisely so knex and this runner cannot collide.
 *
 * It is kept because its state in PRODUCTION is unverified, and deleting a
 * migration runner whose bookkeeping might be live elsewhere is not reversible
 * by inspection. Retiring it is a separate, deliberate decision — see
 * claude/research/engineering/migration-chain-drift-decision.md §6.
 */
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

// Load .env.local if DATABASE_URL is not already set
if (!process.env.DATABASE_URL) {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
  } catch {
    // dotenv not available — rely on environment variable
  }
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations')

async function run() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[migrate] ❌ DATABASE_URL is not set')
    process.exit(1)
  }

  // Parse the URL to strip sslmode query param (same pattern as config/db.ts)
  const parsedUrl = new URL(url)
  parsedUrl.searchParams.delete('sslmode')

  const client = new Client({
    connectionString: parsedUrl.toString(),
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log('[migrate] Connected to database')

    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         serial      PRIMARY KEY,
        filename   varchar(255) NOT NULL UNIQUE,
        applied_at timestamptz  DEFAULT now()
      );
    `)

    // Read migration files in sorted order
    const allFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    if (allFiles.length === 0) {
      console.log('[migrate] No SQL files found in db/migrations/')
      return
    }

    // Fetch already-applied migrations
    const { rows } = await client.query('SELECT filename FROM _migrations')
    const applied = new Set(rows.map((r) => r.filename))

    const pending = allFiles.filter((f) => !applied.has(f))

    if (pending.length === 0) {
      console.log('[migrate] ✅ All migrations already applied — nothing to do')
      return
    }

    console.log(`[migrate] ${pending.length} pending migration(s): ${pending.join(', ')}`)

    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename)
      const sql = fs.readFileSync(filepath, 'utf8')

      console.log(`[migrate] Applying: ${filename}`)

      // Run migration + record it atomically
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
        console.log(`[migrate] ✅ Applied: ${filename}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`[migrate] ❌ Failed: ${filename}`)
        console.error(err.message)
        process.exit(1)
      }
    }

    console.log('[migrate] ✅ All migrations applied successfully')
  } finally {
    await client.end()
  }
}

run()
