'use server'
import { createCookie, getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { requireUser } from '@/lib/requireUser'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { sendWelcomeEmail } from '@/lib/email/send'

export async function addAgency(data) {
  const start = Date.now()
  const email = normalizeEmail(data?.user?.email)
  let success = false
  let newUser: { email: string; firstName: string } | null = null
  let createdUserId: number | null = null
  try {
    await db.transaction(async (trx) => {
      const agency = await trx('agencies').insert(data.agency).returning('id')
      const agencyId = agency[0]?.id

      const [user] = await trx('users')
        .insert({
          ...data.user,
          email,
          agencyId,
          role: 'ADMIN',
        })
        .returning('*')
      await trx('users_info').insert({ id: user.id }).onConflict('id').merge()
      await trx('default_settings').insert({ userId: user.id })
      newUser = { email: user.email, firstName: user.firstName }
      createdUserId = user.id
      success = true
    })
  } catch (err: any) {
    if (err?.code === '23505') {
      console.warn(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=fail reason=duplicate`)
      return { error: 'כתובת האימייל הזו כבר רשומה במערכת' }
    }
    console.error(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=fail reason=server_error`, err)
    return { error: 'אירעה שגיאה, נסה שוב' }
  }

  if (success && newUser && createdUserId) {
    await createCookie(createdUserId)
    console.log(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=success`)
    after(() => sendWelcomeEmail(newUser!))
    redirect('/leads')
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
