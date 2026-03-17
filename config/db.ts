import knex from 'knex'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

export const db = knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  },
  pool: {
    min: 0,
    max: 10,
  },
})

// # DEV repo
// git remote set-url  origin https://github.com/zvijude/allin_test.git

// # PROD repo
// git remote set-url origin https://github.com/zvijude/allin_app.git

// # show current remot
// git remote -v

// buiild
