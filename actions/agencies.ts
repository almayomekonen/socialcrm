'use server'
import { createCookie, getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/requireUser'

export async function addAgency(data) {
  let success = false
  try {
    await db.transaction(async (trx) => {
      const agency = await trx('agencies').insert(data.agency).returning('id')
      const agencyId = agency[0]?.id

      const fullName = `${data.user.firstName ?? ''} ${data.user.lastName ?? ''}`.trim()
      const [user] = await trx('users')
        .insert({
          ...data.user,
          name: fullName || 'User',
          agencyId,
          role: 'ADMIN',
        })
        .returning('*')
      await trx('users_info').insert({ id: user.id })
      await trx('default_settings').insert({ userId: user.id })
      await createCookie(user.id)
      success = true
    })
  } catch (err: any) {
    if (err?.code === '23505') {
      return { error: 'כתובת האימייל הזו כבר רשומה במערכת' }
    }
    return { error: 'אירעה שגיאה, נסה שוב' }
  }

  if (success) {
    redirect('/')
  }
  return success
}

export async function updatePkg(pkg) {
  const user = await getUser()
  await db('agencies').where({ id: user.agencyId }).update({ pkg })
  revalidatePath('/deals')
  revalidatePath('/settings/update_payment')
}

export async function updateAgency(data, id) {
  await requireUser()
  await db('agencies').where({ id }).update(data)
  revalidatePath('/settings/update_agency')
}
