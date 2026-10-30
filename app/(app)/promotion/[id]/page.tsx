import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { getPromo, getPromoTotals, getTeamsPromoTotals } from '@/db/promos'
import { formatNumAndPrecent } from '@/components/promo/funcs'
import PromoTable from '@/components/promo/PromoTable'
import UserPromo from '@/components/promo/UserPromo'
import { db } from '@/config/db'
import { addNotIncludedUsers } from '@/db/sumSales'
import { isAdmin } from '@/types/roles'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language — Hebrew ('פרטי קמפיין') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('performance.promotion.detailTitle') }
}

export default async function PromotionPage({ params, searchParams }) {
  const user = await getUser()

  /**
   * DESKTOP-ONLY SECTION. The detail page carries the same gate as the list: a
   * campaign is a wide per-נציג breakdown table, and reaching it by direct URL
   * must not be a way around the section's handoff.
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='promotion' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const region = regionAttrs(locale)
  const { id } = await params
  let { filter } = await searchParams
  try { filter = filter ? JSON.parse(filter) : {} } catch { filter = {} }
  let promo = await getPromo(id)
  if (!promo) return <p className='font-bold text-lg m-4' {...region}>{t('performance.promotion.notFound')}</p>
  try { promo.goals = JSON.parse(promo.goals) } catch { return <p className='font-bold text-lg m-4' {...region}>{t('performance.promotion.loadError')}</p> }
  const conditions = promo.goals.conditions

  const sql = db
    .where({ action: 'מכירה' })
    .whereNotIn('status', ['נגנז', 'בוטל'])
    .whereBetween('offrDt', [promo.start, promo.end])

  if (promo.isPromoGrp) return TeamPromo({ promo, sql, locale })

  let userTotals = await getPromoTotals(conditions, sql.clone().whereIn('userId', promo.combined_ids))
  if (!userTotals.length)
    return (
      <div {...region}>
        <UserPromo curUser={null} promo={promo} locale={locale} />
        <p className='font-bold text-lg mt-4'>{t('performance.promotion.noData')}</p>
      </div>
    )
  const firstColName = userTotals[0] ? Object.keys(userTotals[0])[1] : null
  if (firstColName) tryme(() => sort(userTotals, firstColName))

  userTotals = await addNotIncludedUsers({ res: userTotals, userIds: promo.combined_ids, nameKey: 'נציג' })

  const userIds = promo.combined_ids

  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    const hasAccess = userIds.some((id) => gotPermIds.includes(id))
    if (!hasAccess) return <p className='font-bold text-lg m-4' {...region}>{t('performance.promotion.notIncluded')}</p>
  }

  const curUser = userTotals.find((el: any) => el.נציג === user.name)

  const formatData = userTotals.map((user) => formatNumAndPrecent(user, promo))

  return (
    <div {...region}>
      <UserPromo curUser={curUser} promo={promo} locale={locale} />
      <PromoTable data={formatData} promo={promo} key={Math.random()} />
    </div>
  )
}

// TEAM PROMO
async function TeamPromo({ promo, sql, locale }: { promo: any; sql: any; locale: UiLocale }) {
  const conditions = promo.goals.conditions
  sql.whereIn('t.id', promo.grpIds)

  const userTotals = await getTeamsPromoTotals({ sql, conditions })
  const formatData = userTotals.map((user) => formatNumAndPrecent(user, promo))

  return (
    <div {...regionAttrs(locale)}>
      <UserPromo curUser={userTotals} promo={promo} locale={locale} />
      <PromoTable data={formatData} promo={promo} key={Math.random()} />
    </div>
  )
}

function sort(arr, key) {
  arr.sort((a, b) => b[key] - a[key])
}

function tryme(fn) {
  try {
    fn()
  } catch (_) {
    // sort is best-effort — continue without sorting
  }
}
