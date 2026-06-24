import knex from 'knex'
import dotenv from 'dotenv'

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local'
dotenv.config({ path: envFile, override: true })

// TEST BRANCH ONLY (inbox-phase1-neon-test) — never merge to main.
// The Vercel↔Neon integration injects DATABASE_URL with precedence over branch-scoped
// overrides, so the preview can't be pointed at a specific Neon branch via DATABASE_URL.
// E2E_DATABASE_URL is a non-integration var that wins here; unset everywhere else → no effect.
const rawUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || ''
if ((process.env.APP_ENV === 'test' || process.env.NODE_ENV === 'test') && !rawUrl) {
  throw new Error('Test environment requires DATABASE_URL')
}

const sslMode = new URL(rawUrl).searchParams.get('sslmode') ?? 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)

function getConnectionString() {
  const url = new URL(rawUrl)
  url.searchParams.delete('sslmode')
  return url.toString()
}

export const db = knex({
  client: 'pg',
  connection: {
    connectionString: getConnectionString(),
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: 0,
    max: 10,
  },
})
