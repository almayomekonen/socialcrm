import knex from 'knex'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const rawUrl = process.env.DATABASE_URL ?? ''

// Only enforce SSL when the URL explicitly requests it.
// Local PostgreSQL servers typically have no SSL support; forcing it causes
// "The server does not support SSL connections" on every fresh pool connection.
const sslMode = new URL(rawUrl).searchParams.get('sslmode') ?? 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)

// Strip sslmode from the URL — pg-connection-string warns on 'require'/'prefer'/'verify-ca'
// in upcoming pg v9. SSL is fully controlled by the explicit ssl object below.
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
