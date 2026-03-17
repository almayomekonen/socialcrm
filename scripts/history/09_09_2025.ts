import { db } from '@/config/db'

async function test() {
  // await addUsersColumns()
  // await addFilesTable()
  // await updateFilesInTables()
  // await renameGrpsViewToTeams()

  console.log('done')
  db.destroy()
}

test()

async function addUsersColumns() {
  await db.schema.alterTable('users_info', function (table) {
    table.string('tifulEmail')
  })
}

async function addFilesTable() {
  await db.schema.createTable('files', function (table) {
    table.increments('id')
    table.text('name')
    table.text('type')
    table.text('size')
    table.text('path')
    table.specificType(
      'url',
      "varchar(255) GENERATED ALWAYS AS (('https://allin-storage.s3.il-central-1.amazonaws.com/' || path)) STORED",
    )
    table.integer('createdById').references('users.id')
    table.timestamp('createdAt').defaultTo(db.fn.now())
    table.integer('taskId').references('tasks.id').onDelete('CASCADE')
    table.integer('clientId').references('clients.id').onDelete('CASCADE')
  })
}

async function updateFilesInTables() {
  //tasks
  await db.schema.alterTable('tasks', function (table) {
    table.dropColumn('files')
  })
  await db.schema.alterTable('tasks', function (table) {
    table.specificType('files', 'integer[]')
  })

  //clients_info
  await db.schema.alterTable('clients_info', function (table) {
    table.dropColumn('idFiles')
  })
  await db.schema.alterTable('clients_info', function (table) {
    table.specificType('idFiles', 'integer[]')
  })

  //task_tmplts
  await db.schema.alterTable('task_tmplts', function (table) {
    table.dropColumn('files')
  })
  await db.schema.alterTable('task_tmplts', function (table) {
    table.specificType('files', 'integer[]')
  })

  //users_info
  await db.schema.alterTable('users_info', function (table) {
    table.dropColumn('agentLicenseFiles')
  })
  await db.schema.alterTable('users_info', function (table) {
    table.specificType('agentLicenseFiles', 'integer[]')
  })

  //promo
  await db.schema.alterTable('promo', function (table) {
    table.dropColumn('files')
  })
  await db.schema.alterTable('promo', function (table) {
    table.specificType('files', 'integer[]')
  })

  await db.schema.alterTable('promo', function (table) {
    table.dropColumn('img')
  })
  await db.schema.alterTable('promo', function (table) {
    table.specificType('img', 'integer')
  })
}

async function renameGrpsViewToTeams() {
  await db.raw(`
    DROP VIEW IF EXISTS _grps;
      CREATE OR REPLACE VIEW _teams AS
      SELECT id,
          name,
          "userIds",
          "mngrIds",
          "updatedAt",
          (SELECT array_agg(json_build_object('id', a.id, 'name', a.name))
                FROM (unnest(ag."userIds") user_id(user_id)
                  JOIN users a ON ((a.id = user_id.user_id)))) AS users,
          (SELECT array_agg(json_build_object('id', m.id, 'name', m.name))
                FROM (unnest(ag."mngrIds") mngr_id(mngr_id)
                  JOIN users m ON ((m.id = mngr_id.mngr_id)))) AS mngrs
      FROM teams ag;
    `)
}
