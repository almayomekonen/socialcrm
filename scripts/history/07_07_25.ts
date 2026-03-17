import { db } from '@/config/db'

async function run() {
  // await db.raw(`
  //   CREATE TYPE family_status_enum AS ENUM ('רווק', 'רווקה', 'נשוי', 'נשואה', 'גרוש', 'גרושה', 'אלמן', 'אלמנה');
  //   CREATE TYPE public.gender_enum AS ENUM ('זכר', 'נקבה');
  //   CREATE TYPE public.tagmul_type_enum AS ENUM ('היקף', 'נפרעים');
  // `)

  // await db.schema.alterTable('clients', (table) => {
  //   table.string('passportNum').nullable()
  //   table.string('licenseNum').nullable()
  //   table.decimal('rank').defaultTo(3)
  //   table.boolean('status').defaultTo(true)
  //   table.text('leadSource')
  //   table.text('employer')
  //   table.text('mail')
  //   table.text('phone')
  //   table.text('secPhone')
  //   table.text('idType').defaultTo('ת"ז')
  //   table.date('idDate')
  //   table.date('birthDate')
  //   table.specificType('gender', 'public.gender_enum')
  //   table.specificType('familyStatus', 'public.family_status_enum')
  //   table.text('address')
  //   table.text('workPlace')
  //   table.integer('salary')
  // })

  // await db.schema.createTable('tasks', (table) => {
  //   table.increments('id').primary()
  //   table.integer('clientId').notNullable().index()
  //   table.integer('userId').index()
  //   table.string('title', 255).notNullable()
  //   table.string('status', 50)
  //   table.integer('tmpltId').index()
  //   table.date('dueDate')
  //   table.timestamp('createdAt').defaultTo(db.fn.now())
  //   table.timestamp('updatedAt').defaultTo(db.fn.now())
  //   table.boolean('completed').defaultTo(false)
  //   table.jsonb('tasks').defaultTo('[]')
  //   table.jsonb('notes').defaultTo('[]')
  //   table.jsonb('files').defaultTo('[]')
  // })

  // await db.schema.createTable('task_tmplts', (table) => {
  //   table.increments('id').primary()
  //   table.string('title', 255).notNullable()
  //   table.jsonb('tasks').defaultTo('[]')
  //   table.jsonb('notes').defaultTo('{}')
  //   table.timestamp('createdAt').defaultTo(db.fn.now())
  //   table.timestamp('updatedAt').defaultTo(db.fn.now())
  //   table.jsonb('files').defaultTo('[]')
  // })

  await db.schema.alterTable('users', (table) => {
    // table.jsonb('otp').nullable()

    // table.dropColumn('target')
    // table.dropColumn('cokiUpdate')

    // Modify columns to match dev
    table.string('phone', 20).unique().alter() // Add UNIQUE constraint and set type
    table.specificType('role', 'public."Role"').notNullable().alter() // Remove default
    // table.specificType('favClientIds', 'integer[]').defaultTo(db.raw('ARRAY[]::integer[]')).alter() // Make nullable
  })

  // await db.schema.alterTable('promo', (table) => {
  //   // Modify 'img' column to be nullable and remove default
  //   table.text('img').nullable().alter()
  // })

  // await db.schema.createTable('bit_prdcts', (table) => {
  //   table.increments('id').primary()
  //   table.string('prdct', 255).notNullable()
  //   table.string('prdctType', 100)
  //   table.string('secPrdctType', 100)
  //   table.string('status', 50).defaultTo('פעיל')
  //   table.string('startDate', 50)
  //   table.date('endDate')
  //   table.integer('clientId')
  //   table.string('company', 255)
  //   table.string('policyNum', 50)
  //   table.decimal('sum', 15, 2)
  //   table.decimal('totalPrem', 15, 2)
  //   table.string('premType', 100)
  //   table.boolean('smoke')
  //   table.text('notes')
  //   table.timestamp('currDate')
  // })

  db.destroy()
}

run()
