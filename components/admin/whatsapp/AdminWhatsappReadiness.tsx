import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { checkOwnerReminderReadiness } from '@/lib/whatsapp/platform/readiness'
import { toReadinessView, type ReadinessView } from '@/lib/whatsapp/platform/readinessView'
import AdminChrome from '@/components/admin/AdminChrome'
import WhatsappReadinessView from './WhatsappReadinessView'

/**
 * Platform-owner readiness of the owner-reminder sender, checked INSIDE the
 * deployment, so it verifies the deployed token without anyone handling a
 * secret. Same gate as every /admin page: a non-owner gets notFound() and no
 * Meta call is made. `connection()` makes every visit a fresh check (never
 * cached). checkOwnerReminderReadiness() is GET-only; only the allowlisted view
 * of its result is rendered.
 */
export default async function AdminWhatsappReadiness() {
  await connection()
  const user = await getUser()
  if (!user || !isPlatformOwner(user.email)) notFound()

  let view: ReadinessView | null = null
  try {
    view = toReadinessView(await checkOwnerReminderReadiness())
  } catch (err) {
    console.error('[admin][whatsapp-readiness] check failed', { name: (err as Error)?.name ?? null })
  }
  const checkedAt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Jerusalem' }).format(new Date())

  return (
    <AdminChrome active='whatsapp'>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-gray-900'>תזכורות בוואטסאפ: בדיקת מוכנות</h1>
        <p className='mt-1 text-sm text-gray-500'>מצב הטוקן, מספר הטלפון והתבנית כפי שהשרת רואה אותם עכשיו.</p>
      </header>
      <WhatsappReadinessView view={view} checkedAt={checkedAt} />
    </AdminChrome>
  )
}
