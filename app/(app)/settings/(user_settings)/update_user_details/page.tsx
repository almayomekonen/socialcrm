import { getUser } from '@/db/auth'
import UserDetailsForm from '@/components/settings/userDetails/UserDetailsForm'
import UserContactForm from '@/components/settings/userDetails/UserPhonesForm'
import { getFullUser } from '@/db/usersNTeams'
import AccordionItem from '@/lib/AccordionItem'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function page() {
  const user = await getUser()
  const res = await getFullUser({
    id: user.id,
    select: [
      'idNum',
      'firstName',
      'lastName',
      'email',
      'phone',
      'fax',
      'officePhone',
      'tifulEmail',
    ],
  })

  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const bodyClass = 'p-6'
  return (
    <div {...regionAttrs(locale)}>
      <h1 className='title mb-8'>{t('settings.account.title.repDetails')}</h1>
      <div className='accordion mb-6 max-w-2xl'>
        <AccordionItem bodyClass={bodyClass} title={t('settings.account.details.personal')}>
          <UserDetailsForm user={res} />
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title={t('settings.account.details.contact')}>
          <UserContactForm user={res} />
        </AccordionItem>
      </div>
    </div>
  )
}
