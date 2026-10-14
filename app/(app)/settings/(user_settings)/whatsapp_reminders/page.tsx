import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getOwnRecipient } from '@/db/ownerWhatsappRecipients'
import AccordionItem from '@/lib/AccordionItem'
import { canUseOwnerWhatsappReminders } from '@/lib/flags/ownerWhatsappReminderFlags'
import { ownerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'
import WhatsappReminderCard from '@/components/settings/whatsappReminders/WhatsappReminderCard'

/** Absent outside the rollout: the nav entry is not rendered and the route 404s. */
export default async function page() {
  const user = await getUser()
  if (!user?.agencyId || !canUseOwnerWhatsappReminders(user.agencyId)) notFound()

  const view = ownerReminderView(await getOwnRecipient(user.agencyId, user.id), new Date())

  return (
    <div>
      <h1 className='title'>תזכורות בוואטסאפ</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        תזכורת בוואטסאפ כשליד מחכה למענה ועדיין לא חזרו אליו
      </p>
      <div className='accordion mb-6 max-w-2xl'>
        <AccordionItem bodyClass='p-6' title='התזכורות שלי' open>
          <WhatsappReminderCard initial={view} />
        </AccordionItem>
      </div>
    </div>
  )
}
