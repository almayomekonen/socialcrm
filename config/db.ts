import knex from 'knex'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

function getConnectionConfig() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  url.searchParams.delete('sslmode')
  return {
    connectionString: url.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
  }
}

export const db = knex({
  client: 'pg',
  connection: getConnectionConfig(),
  pool: {
    min: 0,
    max: 10,
  },
})
