import { db } from '@/config/db'

async function run() {
  // await db.raw(`
  //   CREATE TYPE public.tagmul_type_enum AS ENUM (
  //       'היקף', 'נפרעים'
  //   );
  // `)

  // await db.schema.createTable('contracts', (table) => {
  //   table.increments('id').primary()
  //   table.string('name', 255).notNullable()
  //   table.string('type', 50).notNullable()
  //   table.integer('leaderId').references('id').inTable('users')
  //   table.specificType('agntIds', 'integer[]')
  //   table.timestamp('createdAt', { useTz: true }).defaultTo(db.fn.now())
  //   table.timestamp('updatedAt', { useTz: true }).defaultTo(db.fn.now())
  // })

  // await db.schema.createTable('contract_prdcts', (table) => {
  //   table.increments('id').primary()
  //   table.integer('contractId').references('id').inTable('contracts')
  //   table.string('branch', 100)
  //   table.specificType('prdcts', 'character varying(100)[]')
  //   table.specificType('prdctTypes', 'character varying(100)[]')
  //   table.specificType('companies', 'character varying(100)[]')
  //   table.double('prcnt')
  //   table.double('fromAmount').defaultTo(0)
  //   table.timestamp('createdAt', { useTz: true }).defaultTo(db.fn.now())
  //   table.timestamp('updatedAt', { useTz: true }).defaultTo(db.fn.now())
  //   table.specificType('tagmulType', 'public.tagmul_type_enum').notNullable().defaultTo('היקף')
  // })

  db.destroy()
}

run()
