import knex from 'knex'
import dotenv from 'dotenv'

/**
 * `.env.local` by default, exactly as before. APP_ENV_FILE lets a throwaway
 * local instance (the card-trial demo walkthrough) point at its own env file and
 * its own database without editing the shared one another dev server is using.
 * Test runs keep their fixed file.
 */
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : process.env.APP_ENV_FILE || '.env.local'
dotenv.config({ path: envFile, override: true })

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
