import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import AdminChrome from '@/components/admin/AdminChrome'
import AssistantDemo from './AssistantDemo'

/**
 * The gated body of /admin/whatsapp/assistant-demo. Same gate as every /admin
 * page: a non-owner gets notFound(). It reads the session, so the page renders
 * it inside <Suspense> (Cache Components), like AdminWhatsappReadiness.
 */
export default async function AssistantDemoPanel() {
  const user = await getUser()
  if (!user || !isPlatformOwner(user.email)) notFound()
  return (
    <AdminChrome active='whatsapp'>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-gray-900'>SocialCRM AI בוואטסאפ: הדמיה</h1>
        <p className='mt-1 text-sm text-gray-500'>תרחישים מתוסרטים עם נתונים בדויים. לא נקרא ולא נכתב שום דבר במערכת, ושום הודעה לא נשלחת.</p>
      </header>
      <AssistantDemo />
    </AdminChrome>
  )
}
