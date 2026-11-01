import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { getOwnRecipient } from '@/db/ownerWhatsappRecipients'
import AccordionItem from '@/lib/AccordionItem'
import { canUseOwnerWhatsappReminders } from '@/lib/flags/ownerWhatsappReminderFlags'
import { isWaAssistantAgency } from '@/lib/flags/waAssistantFlags'
import { activationConsentFor } from '@/lib/whatsapp/platform/consentText'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { ownerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'
import WhatsappReminderCard from '@/components/settings/whatsappReminders/WhatsappReminderCard'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Absent outside the audience or without product access: the nav entry is not rendered and the route 404s. */
export default async function page() {
  const user = await getUser()
  if (!user?.agencyId || !canUseOwnerWhatsappReminders(user.agencyId)) notFound()
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) notFound()

  // The assistant's consent (v3) is offered only where it is enabled for the agency; elsewhere reminders only (v2).
  const assistantEnabled = isWaAssistantAgency(user.agencyId)
  const view = ownerReminderView(await getOwnRecipient(user.agencyId, user.id), new Date(), { assistantEnabled })

  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  return (
    <div {...regionAttrs(locale)}>
      <h1 className='title'>{t('settings.account.title.reminders')}</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        {t('settings.account.reminders.intro')}
      </p>
      <div className='accordion mb-6 max-w-2xl'>
        <AccordionItem bodyClass='p-6' title={t('settings.account.reminders.mine')} open>
          <WhatsappReminderCard initial={view} consent={activationConsentFor(assistantEnabled)} />
        </AccordionItem>
      </div>
    </div>
  )
}
