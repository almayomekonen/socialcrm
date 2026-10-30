import { getUser } from '@/db/auth'
import AiSettingsForm from '@/components/settings/default/AiSettingsForm'
import { getDefaultSettings } from '@/db/usersNTeams'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function page() {
  const user = await getUser()
  const data = await getDefaultSettings(user.id)
  const { locale } = await getUiLocaleState(user)
  return (
    <div {...regionAttrs(locale)}>
      <h1 className='title mb-8'>{translatorFor(locale)('settings.account.title.system')}</h1>
      <AiSettingsForm key={Math.random()} userId={user.id} data={data} />
    </div>
  )
}
