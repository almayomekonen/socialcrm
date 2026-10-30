import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { getServerT } from '@/lib/i18n/server'

/** One tab title for the group (pages without their own, as before), in the interface language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('settings.account.title.group') }
}

// The 24px above the page title is the settings chrome's job, not this group's
// — it used to live here, which is why user pages sat 24px lower than admin ones.
export default async function UserSettingsLayout({ children }) {
  return children
}
