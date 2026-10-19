import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import AdminChrome from '@/components/admin/AdminChrome'
import AssistantDemo from '@/components/admin/whatsapp/assistantDemo/AssistantDemo'

export const metadata: Metadata = { title: 'הדמיית SocialCRM AI · ניהול מערכת' }

/**
 * A SIMULATION of SocialCRM AI on WhatsApp, for showing the product. Platform
 * owners only, the same gate as every /admin page. The demo component makes no
 * server call: nothing is read from or written to any CRM, and nothing is sent.
 */
export default async function AssistantDemoPage() {
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
