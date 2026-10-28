import { notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isAdmin } from '@/types/roles'
import { getUiLocaleState } from '@/lib/i18n/server'
import LanguageSettings from '@/components/settings/language/LanguageSettings'

export default async function LanguagePage() {
  const user = await getUser()
  const state = await getUiLocaleState()
  // Outside the UI_LOCALE_* rollout the page does not exist, like its nav item.
  if (!user || !state.enabled) notFound()

  return (
    <LanguageSettings
      locale={state.locale}
      source={state.source}
      userLocale={state.userLocale}
      agencyLocale={state.agencyLocale}
      canManageAgency={isAdmin(user.role)}
    />
  )
}
