const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

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
