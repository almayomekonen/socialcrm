import { db } from '@/config/db'

async function run() {
  // await createDefaultSettingsTable()
  // await addDefaultSettingsForAllUsers()
  // await addLeadToClientsTable()
  // await addAgentLicenseTypeToUsersTable()
  // await addLicenseTypeToAllUsers()
  // await addAgentLicenseName()
  db.destroy()
  console.log('done')
}

run()

async function createDefaultSettingsTable() {
  await db.schema.createTable('default_settings', (table) => {
    table.increments('id').primary()
    table.integer('userId').notNullable().references('users.id').onDelete('CASCADE')

    // הגדרות סיווג לקוח
    table.text('bronze').defaultTo(300)
    table.text('gold').defaultTo(1000)

    // הגדרות ai
    table.text('achuzHafkadaPensia').defaultTo(10)
    table.text('achuzDmeiNihulKupatGemelTzvira').defaultTo(0.8)
    table.text('achuzDmeiNihulKupatGemelHafkada').defaultTo(0)
    table.text('achuzDmeiNihulKerenHishtalmutTzvira').defaultTo(0.8)
    table.text('achuzDmeiNihulKerenHishtalmutHafkada').defaultTo(0)
    table.text('achuzDmeiNihulPensiaTzvira').defaultTo(0.2)
    table.text('achuzDmeiNihulPensiaHafkada').defaultTo(2)
    table.text('achuzDmeiNihulMenahalimTzvira').defaultTo(0.6)
    table.text('monthsLoButzaPgishatSherutTkufatit').defaultTo(24)
    table.text('achuzKfitzatPremiaBitucheiPrat').defaultTo(10)
    table.text('monthsLidimSheloHufku').defaultTo(8)
    table.text('schumKerenHishtalmutHafkadaAtzmaiLeloHafkada').defaultTo(20520)
    table.text('achuzPensiaHafkadaAtzmaiLeloHafkada').defaultTo(16.5)
    table.boolean('isBituachHaimMutzarHaser').defaultTo(false)
    table.boolean('isBituachBriutMutzarHaser').defaultTo(false)
    table.boolean('isMahalotKashotMutzarHaser').defaultTo(false)
    table.boolean('isGemelLehashkaaMutzarHaser').defaultTo(false)
    table.text('monthsUpdated').defaultTo(24)
    table.boolean('isRiskUpdated').defaultTo(false)
    table.boolean('isMahalotKashotUpdated').defaultTo(false)
  })
}

async function addDefaultSettingsForAllUsers() {
  const users = await db('users').select('id')
  for (const user of users) {
    await db('default_settings').insert({ userId: user.id })
  }
}

async function addLeadToClientsTable() {
  await db.schema.alterTable('clients', (table) => {
    table.boolean('lead').defaultTo(false)
  })
}

async function addAgentLicenseTypeToUsersTable() {
  await db.schema.alterTable('users_info', (table) => {
    table.text('agentLicenseType')
  })
}

async function addLicenseTypeToAllUsers() {
  const users = await db('users').select('id')
  for (const user of users) {
    await db('users_info').update({ agentLicenseType: 'נציג ביטוח פנסיוני' }).where('id', user.id)
  }
}

async function addAgentLicenseName() {
  await db.schema.alterTable('users_info', (table) => {
    table.text('agentLicenseName')
  })
}
