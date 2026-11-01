import { getUser } from '@/db/auth'
import { Metadata } from 'next'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** The group's tab title (pages without their own), in the interface language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('admin.page.title.group') }
}

export default async function AdminSettingsLayout({ children }) {
  const user = await getUser()
  if (user.role != 'ADMIN') {
    const { locale } = await getUiLocaleState(user)
    return <div {...regionAttrs(locale)}>{translatorFor(locale)('admin.page.denied')}</div>
  }

  return children
}
