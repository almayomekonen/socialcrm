import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { getServerT } from '@/lib/i18n/server'

/** Tab title in the interface language — Hebrew ('היום') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('today.title') }
}

export { default } from '@/components/home/DashboardPage'
