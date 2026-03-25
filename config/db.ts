import knex from 'knex'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// Strip sslmode from the URL — pg-connection-string warns on 'require'/'prefer'/'verify-ca'
// in upcoming pg v9. SSL is fully controlled by the explicit ssl object below.
function getConnectionString() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  url.searchParams.delete('sslmode')
  return url.toString()
}

export const db = knex({
  client: 'pg',
  connection: {
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
  },
  pool: {
    min: 0,
    max: 10,
  },
})
