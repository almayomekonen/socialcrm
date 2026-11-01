import { getTeams, getUsers } from '@/db/usersNTeams'
import { getPromos } from '@/db/promos'
import PromoCards from '@/components/promo/PromoCards'
import { getUser } from '@/db/auth'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function EditPromotionPage() {
  const teams = await getTeams()
  const users = await getUsers()

  const promos = await getPromos()
  const { locale } = await getUiLocaleState(await getUser())

  if (promos.length === 0) {
    return (
      <div className='flex items-center justify-center h-64 text-gray-400' {...regionAttrs(locale)}>
        {translatorFor(locale)('admin.promos.empty')}
      </div>
    )
  }

  return (
    <div className='mb-8' {...regionAttrs(locale)}>
      <PromoCards promos={promos} teams={teams} users={users} />
    </div>
  )
}
