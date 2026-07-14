import knex from 'knex'
import dotenv from 'dotenv'

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local'
// Do not override an already-set DATABASE_URL — lets `vercel env run` and other
// one-off scripts target production while .env.local keeps localhost for dev.
dotenv.config({ path: envFile, override: !process.env.DATABASE_URL })

const rawUrl = process.env.DATABASE_URL ?? ''
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
