import { db } from '@/config/db'

async function run() {
  //   user_permissions table
  await db.schema.createTable('user_perms', (table) => {
    table.integer('gotId').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.integer('gaveId').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.primary(['gotId', 'gaveId'])
  })

  //   user_groups table
  await db.schema.createTable('user_teams', (table) => {
    table.integer('userId').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.integer('teamId').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE')
    table.enum('type', ['user', 'mngr', 'office']).notNullable().defaultTo('user')
    table.primary(['userId', 'teamId'])
  })

  // add officeIds
  await db.schema.alterTable('teams', (table) => {
    table.specificType('officeIds', 'integer[]').defaultTo(db.raw('ARRAY[]::integer[]'))
  })

  console.log('Done')
  db.destroy()
}

run()
