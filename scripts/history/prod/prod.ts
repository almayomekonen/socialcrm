import { db } from '@/config/db'
// import { _get_perm_ids, _get_perms_by_role } from '../../views/_users_perms'
// import { _flat_sales, _sales, _totals_and_goals } from '../../views/views'

async function run() {
  // await dropViews()

  // await editTables()

  // await createSaleUsers()

  // await createViews()

  // await _totals_and_goals()

  // await _get_perms_by_role()

  // await db.schema.alterTable('users', (table) => {
  //   table.integer('createdById').references('id').inTable('users')
  // })

  await db.schema.alterTable('users', (table) => {
    // table.renameColumn('gotGrpPerm', 'gotPermTeamIds')
    table.renameColumn('gotPerm', 'gotPermIds')
    table.renameColumn('gavePerm', 'gavePermIds')
  })

  console.log('Done')
  db.destroy()
}
run()

async function editTables() {
  // make lastName '' deafult - ידנית
  // await db.schema.alterTable('users', (table) => {
  //   // table.dropColumn('target')
  //   // table.dropColumn('cokiUpdate')
  //   // table.text('email').nullable().alter()
  //   // table.specificType('role', 'public."Role"').notNullable().alter()
  //   // table.renameColumn('gotGrpPerm', 'gotPermTeamIds') //  needed for creating מתפעל
  //   // table.renameColumn('gotPerm', 'gotPermIds') //  needed for creating מתפעל
  //   // table.renameColumn('gavePerm', 'gavePermIds') //  needed for creating מתפעל
  // })
  // await db.schema.alterTable('teams', (table) => {
  //   table.renameColumn('mngr_ids', 'mngrIds')
  //   table.renameColumn('agnt_ids', 'userIds')
  // })
  // await db.schema.alterTable('promo', (table) => {
  //   table.renameColumn('agnt_ids', 'userIds')
  //   table.renameColumn('grp_ids', 'grpIds')
  // })
  // await db.schema.alterTable('contracts', (table) => {
  //   table.renameColumn('leaderId', 'mngrId')
  //   table.renameColumn('agntIds', 'userIds')
  //   table.dropForeign('leaderId', 'contracts_leaderid_foreign')
  //   table.foreign('mngrId', 'contracts_leaderId_fkey').references('users.id')
  // })
  // await db.raw(`ALTER TYPE public."Role" ADD VALUE 'EXT';`)
}

async function createViews() {
  // await _get_perm_ids()
  // await _grps()
  // await _sales()
  // await _flat_sales()
}

async function createSaleUsers() {
  await db.schema.createTable('sale_users', (table) => {
    table.integer('saleId').notNullable().references('id').inTable('sales').onDelete('CASCADE')
    table.integer('userId').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.float('prcnt').notNullable()
    table.float('amount').notNullable()
    table.float('cmsn').notNullable()
    table.float('agencyMonthlyCmsn')
    table.float('agencyYearlyCmsn')
    table.float('monthlyCmsn')
    table.float('yearlyCmsn')
    table.float('mngrMonthlyCmsn')
    table.float('mngrYearlyCmsn')
    table.timestamp('createdAt').defaultTo(db.fn.now())
    table.timestamp('updatedAt').defaultTo(db.fn.now())
    table.primary(['saleId', 'userId'])
  })
}

async function dropViews() {
  await db.raw(`
    DROP VIEW IF EXISTS _flat_sales;
    DROP VIEW IF EXISTS _sales;
    DROP VIEW IF EXISTS _grps;
    DROP FUNCTION IF EXISTS _get_perm_ids(integer);
  `)
}
