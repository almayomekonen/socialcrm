'use server'
import { createCookie, getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/requireUser'

export async function addAgency(data) {
  let success = false
  await db.transaction(async (trx) => {
    const agency = await trx('agencies').insert(data.agency).returning('id')
    const agencyId = agency[0]?.id

    const user = await trx('users')
      .insert({
        ...data.user,
        agencyId,
        role: 'ADMIN',
      })
      .returning('id')
    await trx('default_settings').insert({ userId: user[0]?.id })
    await createCookie(user[0]?.id)
    success = true
  })

  if (success) {
    redirect('/')
  }
  return success
}

export async function updatePkg(pkg) {
  const user = await getUser()
  await db('agencies').where({ id: user.agencyId }).update({ pkg })
  revalidatePath('/')
  revalidatePath('/settings/update_payment')
}

export async function updateAgency(data, id) {
  await requireUser()
  await db('agencies').where({ id }).update(data)
  revalidatePath('/settings/update_agency')
}
