import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { getPromos, getPromosByUserId } from '@/db/promos'
import { isAdmin, Roles } from '@/types/roles'
import Link from 'next/link'
import AccordionItem from '@/lib/AccordionItem'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language — Hebrew ('קמפיינים') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('performance.promotion.title') }
}

export default async function PromotionPage() {
  const user = await getUser()

  /**
   * DESKTOP-ONLY SECTION. Returned before the promo reads, so a phone receives
   * neither the campaign boxes nor the past-campaigns accordion
   * (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='promotion' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const region = regionAttrs(locale)
  const { gotPermIds } = await getPerms(user)
  let promos = isAdmin(user.role) ? await getPromos() : await getPromosByUserId(user.id, gotPermIds)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const pastPromos = promos.filter((promo) => promo.end < today)
  promos = promos.filter((promo) => promo.end >= today)

  if (!promos.length)
    return (
      <div className='my-8' {...region}>
        <h1 className='title mb-6'>{t('performance.promotion.heading')}</h1>
        <div className='text-center py-16 border rounded-lg bg-white max-w-md mx-auto'>
          <p className='text-4xl mb-4'>🏆</p>
          <p className='text-xl font-semibold mb-2'>{t('performance.promotion.empty.title')}</p>
          <p className='text-gray-500 text-sm leading-relaxed'>
            {t('performance.promotion.empty.line1')}
            <br />
            {t('performance.promotion.empty.line2')}
          </p>
        </div>
      </div>
    )

  return (
    <div className='' {...region}>
      <h1 className='title mb-4'>{t('performance.promotion.heading')}</h1>

      <PromoBox promos={promos} />
      <div className='accordion border rounded-lg my-6  bg-white'>
        <AccordionItem title={t('performance.promotion.past')}>
          <PromoBox promos={pastPromos} />
        </AccordionItem>
      </div>
    </div>
  )
}

function PromoBox({ promos }) {
  return (
    <section className='flex '>
      {promos.map((promo) => {
        return (
          <Link href={`/promotion/${promo.id}`} key={promo.id}>
            <div className='w-80 bg-white p-6 rounded-md shadow-1 mb-4 min-h-[360px]'>
              <img src={promo.img?.url || '/media/placeholder.webp'} alt='' className='h-40 w-full rounded-md' />
              <h1 className='text-xl font-semibold my-3'>{promo.title}</h1>
              <p className='line-clamp-3'>{promo.desc}</p>
            </div>
          </Link>
        )
      })}
    </section>
  )
}
