import knex from 'knex'

import dotenv from 'dotenv'
dotenv.config()

export const db = knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DB_PROD_URL || process.env.DB_DEV_URL || process.env.DB_LOCAL_URL,
  },
})

// # DEV repo
// git remote set-url  origin https://github.com/zvijude/allin_test.git

// # PROD repo
// git remote set-url origin https://github.com/zvijude/allin_app.git

// # show current remot
// git remote -v

// buiild
