import { db } from '@/config/db'

// const users = [
//   { name: 'חן שקד', createdById: 68, id: 190 },
//   { name: 'משה סנג׳רו', createdById: 73, id: 191 },
//   { name: 'סוסובר', createdById: 54, id: 192 },
//   { name: 'וילנר', createdById: 54, id: 193 },
//   { name: 'שוקי קלפר', createdById: 13, id: 194 },
//   { name: '0', createdById: 73, id: 195 },
//   { name: 'ארנברג', createdById: 54, id: 196 },
//   { name: 'אורן ידיד', createdById: 66, id: 197 },
//   { name: 'קובי יועץ משכנתאות', createdById: 78, id: 198 },
//   { name: 'גבי לב', createdById: 22, id: 199 },
//   { name: 'אילן ברבי', id: 16, createdById: 123 },
//   { name: 'יוסי שלו', id: 32, createdById: 31 },
// ] as any

// const users = [
//   { name: 'חן שקד', createdById: 68, id: 187 },
//   { name: 'משה סנג׳רו', createdById: 73, id: 188 },
//   { name: 'סוסובר', createdById: 54, id: 189 },
//   { name: 'וילנר', createdById: 54, id: 190 },
//   { name: 'שוקי קלפר', createdById: 13, id: 191 },
//   { name: '0', createdById: 73, id: 192 },
//   { name: 'ארנברג', createdById: 54, id: 193 },
//   { name: 'אורן ידיד', createdById: 66, id: 194 },
//   { name: 'קובי יועץ משכנתאות', createdById: 78, id: 195 },
//   // { name: "משה סנג'רו", createdById: undefined, id: 196 },
//   { name: 'גבי לב', createdById: 22, id: 197 },
//   { name: 'יוסי שלו', id: 32, createdById: 31 },
//   { name: 'אילן ברבי', id: 16, createdById: 123 },
// ] as any

const users = [
  { name: 'אילן ברבי', id: 16, createdById: 123 },
  { name: 'יוסי שלו', id: 32, createdById: 31 },
  { name: 'חן שקד', createdById: 68, id: 190 },
  { name: 'משה סנג׳רו', createdById: 73, id: 191 },
  { name: 'סוסובר', createdById: 54, id: 192 },
  { name: 'וילנר', createdById: 54, id: 193 },
  { name: 'שוקי קלפר', createdById: 13, id: 194 },
  { name: '0', createdById: 73, id: 195 },
  { name: 'ארנברג', createdById: 54, id: 196 },
  { name: 'אורן ידיד', createdById: 66, id: 197 },
  { name: 'קובי יועץ משכנתאות', createdById: 78, id: 198 },
  { name: 'גבי לב', createdById: 22, id: 200 },
] as any

async function run() {
  // await trimOtherAgntsAndUsers()
  // await getDistinctOtherAgnts() //will get allOther agnt names - create users array and use it from now
  // await checkOtherAgntsIsInUsers() // put the id of the user next to the name in the users array

  // await countSangero()
  // await updateSangero()
  // await countSangero()

  // await getCreatedById() // returns new users array with createdById - use it from now

  // comment out users that already have id
  // await insertUsers() // will return the users with the assignedIds - use it from now

  //TESTING
  // const res = await db('users').where('id', 197).select('id', 'name')
  // console.log('res', res)

  // comment back in users that already have id
  // await updateAgnt2Id()

  // FINAL TEST
  // await getSalesWithOtherAgnt()
  // await getUserSales()

  console.log('Done')
  db.destroy()
}
run()

async function getUserSales() {
  const res = await db('sales')
    .where({ otherAgnt: 'משה סנג׳רו', action: 'מינוי סוכן' })
    .select('id', 'otherAgnt', 'action', 'status')
  console.log('user sales', res)
  console.log('length', res.length)
}

async function updateAgnt2Id() {
  for (const user of users) {
    const res = await db('sales').where('otherAgnt', user.name).update({ agnt2Id: user.id }).returning('id')
    console.log('res', res)
    console.log('user', user)
  }
  console.log('updateAgnt2Id')
}

async function insertUsers() {
  const newUsers = users.map((user) => {
    return {
      firstName: user.name.split(' ')[0] || '',
      lastName: user.name.split(' ').slice(1).join(' ') || '',
      role: 'EXT' as any,
      createdById: user.createdById,
    }
  })

  const createdUsers = await db('users').insert(newUsers).returning('*')
  console.log('createdUsers', createdUsers)

  asignIds(createdUsers)
}
async function asignIds(createdUsers) {
  users.forEach((user) => {
    const found = createdUsers.find((el) => el.name.trim() == user.name.trim())
    user.id = found?.id
  })

  console.log('users', users)
}

async function addColumnCreatedById() {
  await db.schema.alterTable('users', (table) => {
    table.integer('createdById').references('id').inTable('users')
  })
}

async function checkOtherAgntsIsInUsers() {
  const names = await db('users')
    .whereIn(
      'name',
      users.map((user) => user.name),
    )
    .select('name', 'id')
  console.log('names', names)
}

async function checkOtherAgntFirstName() {
  const res = await db('users')
    .whereIn(
      'firstName',
      users.map((user) => user.name.split(' ')[0]),
    )
    .select('firstName', 'lastName')
  console.log('res', res)
}

async function getDistinctOtherAgnts() {
  const res = await db('sales').whereNotNull('otherAgnt').distinct('otherAgnt')
  console.log(res)
}

async function getCreatedById() {
  const res = await db('sales').whereNotNull('otherAgnt').select('agntId', 'otherAgnt').distinct()

  users.forEach((user) => {
    const sale = res.find((el) => el.otherAgnt == user.name)
    user.createdById = sale?.agntId
  })

  console.log('users', users)
}

async function getSalesWithOtherAgnt() {
  const res = await db('sales').whereNotNull('otherAgnt').whereNull('agnt2Id').select('otherAgnt', 'id', 'agnt2Id')
  console.log('otherAgnts without agnt2Id', res)
}

async function trimOtherAgntsAndUsers() {
  await db('sales')
    .whereNotNull('otherAgnt')
    .update({ otherAgnt: db.raw('trim(??)', ['otherAgnt']) })

  await db('users').update({ firstName: db.raw('trim(??)', ['firstName']), lastName: db.raw('trim(??)', ['lastName']) })

  console.log('trimOtherAgntsAndUsers')
}

async function updateSangero() {
  await db('sales').where('otherAgnt', "משה סנג'רו").update({ otherAgnt: 'משה סנג׳רו' })
  console.log('updateSangero')
}

async function countSangero() {
  const res = await db('sales').where('otherAgnt', 'משה סנג׳רו').count()
  console.log('countSangero', res)
}

// const user = users[11]
// const salesCount = await db('sales').where('otherAgnt', user.name).count('id')
//
// const newUsers = []
// for (const name of agentNames) {
//   const nameParts = name.trim().split(' ')
//   const newUser = await db('users')
//     .insert({
//       firstName: nameParts[0] || '',
//       lastName: nameParts.slice(1).join(' ') || '',
//       role: 'EXT' as Role,
//     })
//     .returning('*')
//   newUsers.push(newUser[0])
//   // }
//
// for (const other of others) {
//   const res = await db('sales').where('otherAgnt', other.name).update({ agnt2Id: other.id }).returning('id')
//   // }

// didnt run it
// await db.schema.alterTable('promo', (table) => {
//   table.specificType('companies', 'text[]')
// })

// ---------------------------------

// const users = [
//   { name: 'חן שקד', createdById: 68, id: 248 },
//   { name: 'סוסובר', createdById: 54, id: 249 },
//   { name: 'משה סנג׳רו', createdById: 73, id: 250 },
//   { name: 'וילנר', createdById: 54, id: 251 },
//   { name: 'שוקי קלפר', createdById: 13, id: 252 },
//   { name: '0', createdById: 73, id: 253 },
//   { name: 'ארנברג', createdById: 54, id: 254 },
//   { name: 'אורן ידיד', createdById: 66, id: 255 },
//   { name: 'קובי יועץ משכנתאות', createdById: 78, id: 256 },
//   { name: 'גבי לב', createdById: 22, id: 257 },
//   { name: 'אילן ברבי', id: 16, createdById: 123 },
//   { name: 'יוסי שלו', id: 32, createdById: 31 },
// ] as any
