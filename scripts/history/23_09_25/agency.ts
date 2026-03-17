// import { db } from '@/config/db'
// import { _get_users_perms, _users_perms } from '../../views/_users_perms'
// import { _flat_sales, _sales, _teams } from '../../views/views'

// async function test() {
//   // await addAgenciesTables()
//   // await addAgencyId()
//   // await addFirstAgency()
//   // await addAgencyIdToTables()
//   // await updateTablesToAgency1()
//   // await updateUnique()
//   // await updateAgencyIdToNotNullable()
//   // await addUserIdToClients()
//   // await _get_users_perms()
//   // await _users_perms()

//   // ------------------
//   // test can be deleted:
//   // let saleIds = await db('sales').where('agencyId', 1).select('id')
//   // saleIds = saleIds.map((sale) => sale.id)
//   // const prdctsAmnt = await db('sale_users').whereIn('saleId', saleIds).count()
//   // const clientsCount = await db('clients').where('agencyId', 1).count()
//   // console.log('prdctsAmnt', prdctsAmnt)
//   // console.log('clientsCount', clientsCount)

//   console.log('done')
//   db.destroy()
// }

// test()

// async function addAgenciesTables() {
//   await db.schema.createTable('agencies', function (table) {
//     table.increments('id').primary()
//     table.text('name').notNullable()
//     table.integer('img').references('files.id')
//     table.text('pkg')
//   })
// }

// async function addAgencyId() {
//   await db.schema.alterTable('users', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })
// }

// async function addFirstAgency() {
//   await db('agencies').insert({
//     id: 1,
//     name: 'פרוביט',
//     pkg: 'ניצן',
//   })

//   await db('users').update({
//     agencyId: 1,
//   })

//   const agency = await db('agencies')
//   console.log(agency)

//   const users = await db('users').count('id')
//   const usersAgency1 = await db('users').where('agencyId', 1).count('id')
//   console.log(users[0].count)
//   console.log(usersAgency1[0].count)
// }

// async function addAgencyIdToTables() {
//   await db.schema.alterTable('sales', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('teams', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('promo', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('clients', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('contracts', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('task_tmplts', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('cmsn_rules', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })

//   await db.schema.alterTable('files', function (table) {
//     table.integer('agencyId').references('agencies.id')
//   })
// }

// async function updateTablesToAgency1() {
//   await db('sales').update({
//     agencyId: 1,
//   })
//   await db('teams').update({
//     agencyId: 1,
//   })
//   await db('promo').update({
//     agencyId: 1,
//   })
//   await db('clients').update({
//     agencyId: 1,
//   })
//   await db('contracts').update({
//     agencyId: 1,
//   })
//   await db('task_tmplts').update({
//     agencyId: 1,
//   })
//   await db('cmsn_rules').update({
//     agencyId: 1,
//   })
//   await db('files').update({
//     agencyId: 1,
//   })
// }

// async function updateUnique() {
//   await db.schema.alterTable('clients', function (table) {
//     table.dropIndex(['idNum'], 'Client_idNum_key')
//   })
//   await db.schema.alterTable('clients', function (table) {
//     table.unique(['idNum', 'agencyId'], 'clients_idNum_agencyId_unique')
//   })

//   await db.schema.alterTable('users', function (table) {
//     table.dropIndex(['firstName', 'lastName'], 'Agnt_firstName_lastName_key')
//   })
//   await db.schema.alterTable('users', function (table) {
//     table.unique(['firstName', 'lastName', 'agencyId'], 'users_firstName_lastName_agencyId_unique')
//   })

//   await db.schema.alterTable('users', function (table) {
//     table.unique(['phone'], 'users_phone_unique')
//   })
// }

// async function updateAgencyIdToNotNullable() {
//   await db.schema.alterTable('users', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })

//   await db.raw('DROP VIEW IF EXISTS _sales')
//   await db.raw('DROP VIEW IF EXISTS _flat_sales')
//   await db.schema.alterTable('sales', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await _sales()
//   await _flat_sales()

//   await db.raw('DROP VIEW IF EXISTS _teams')
//   await db.schema.alterTable('teams', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await _teams()

//   await db.schema.alterTable('promo', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await db.schema.alterTable('clients', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await db.schema.alterTable('contracts', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await db.schema.alterTable('task_tmplts', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await db.schema.alterTable('cmsn_rules', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
//   await db.schema.alterTable('files', function (table) {
//     table.integer('agencyId').notNullable().alter()
//   })
// }

// async function addUserIdToClients() {
//   await db.schema.alterTable('clients', function (table) {
//     table.integer('userId').references('users.id')
//   })
//   await db('clients').update({
//     userId: db.raw('"createdById"'),
//   })
// }

// // testing purposes

// async function delTmpAgencies() {
//   const clientIds = db('clients').whereNot('agencyId', 1).select('id')
//   const usersIds = db('users').whereNot('agencyId', 1).select('id')
//   await db('client_lists').whereRaw(`"clientIds" && ARRAY(?)`, [clientIds]).del()
//   await db('client_lists').whereIn('userId', usersIds).del()
//   await db('files').whereIn('createdById', usersIds).del()
//   await db('sales').whereIn('clientId', clientIds).del()
//   await db('clients').whereNot('agencyId', 1).del()
//   await db('users').whereNot('agencyId', 1).del()
//   await db('teams').whereNot('agencyId', 1).del()
//   await db('promo').whereNot('agencyId', 1).del()
//   await db('contracts').whereNot('agencyId', 1).del()
//   await db('task_tmplts').whereNot('agencyId', 1).del()
//   await db('cmsn_rules').whereNot('agencyId', 1).del()
//   await db('agencies').whereNot('id', 1).del()
// }
