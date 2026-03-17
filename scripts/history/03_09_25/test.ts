import { db } from '@/config/db'

async function test() {
  const client = await db('clients').where({ id: 10884 }).first()
  console.log('client', client)

  console.log('done')
  db.destroy()
}

test()

async function createChatSubjectsTable() {
  await db.schema.createTable('chat_subjects', (table) => {
    table.increments('id').primary()
    table.integer('userId').notNullable().references('id').inTable('users')
    table.text('name').notNullable()
    table.text('cacheName').unique().nullable()
    table.timestamp('expiresAt').nullable()
    table.text('systemInstruction')
    table.text('model')
    table.specificType('files', 'text[]')
  })
}

async function addPasskeyUsers() {
  await db.schema.alterTable('users', (table) => {
    table.text('tmpChallenge').nullable()
    table.json('passkeyConfig').nullable()
  })
}
