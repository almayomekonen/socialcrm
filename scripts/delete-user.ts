import { db } from '../config/db'

async function run() {
  const user = await db('users').where({ email: 'fasikain827@gmail.com' }).first()
  if (!user) {
    console.log('User not found')
    await db.destroy()
    return
  }

  console.log(`Deleting user ${user.id} (agencyId: ${user.agencyId})...`)

  await db('clients').where({ agencyId: user.agencyId }).delete()
  await db('client_lists').where({ userId: user.id }).delete()
  await db('default_settings').where({ userId: user.id }).delete()
  await db('users').where({ agencyId: user.agencyId }).delete()
  await db('agencies').where({ id: user.agencyId }).delete()

  console.log('Done.')
  await db.destroy()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
