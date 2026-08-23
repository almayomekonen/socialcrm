const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env.local'
require('dotenv').config({ path: envFile })

/**
 * SSL is decided by the URL's `sslmode`, exactly as `config/db.ts` decides it for
 * the application. Previously this file forced `ssl: { rejectUnauthorized: false }`
 * unconditionally, so the knex CLI could not reach a local Postgres at all
 * ("The server does not support SSL connections"). Hosted databases carry
 * `sslmode=require` and are unaffected.
 */
const rawUrl = process.env.DATABASE_URL ?? ''
const sslMode = rawUrl ? (new URL(rawUrl).searchParams.get('sslmode') ?? 'disable') : 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)

function connectionString() {
  if (!rawUrl) return rawUrl
  const url = new URL(rawUrl)
  url.searchParams.delete('sslmode')
  return url.toString()
}

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: {
    connectionString: connectionString(),
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: 0,
    max: 10,
  },
  migrations: {
    directory: './migrations',
    extension: 'cjs',
  },
}
