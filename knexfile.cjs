require('dotenv').config({ path: '.env.local' })

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
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
