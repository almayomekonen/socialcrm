import { db } from '@/config/db'

async function test() {
  await createInvitationsTable()
  console.log('done')
  db.destroy()
}

test()

async function createInvitationsTable() {
  await db.schema.createTable('invitations', (table) => {
    table.increments('id').primary()
    table.text('email').notNullable()
    table.text('token').notNullable()
    table.text('role').notNullable()
    table.text('firstName').notNullable()
    table.text('lastName').notNullable()
    table.text('phone')
    table.timestamp('createdAt').defaultTo(db.fn.now())
    table.timestamp('expiresAt').notNullable()
    table.integer('createdById').notNullable().references('users.id')
    table.integer('agencyId').notNullable().references('agencies.id')
  })
}
