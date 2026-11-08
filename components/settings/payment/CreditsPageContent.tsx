import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import CreditBalance from '@/components/settings/payment/CreditBalance'
import { getCreditBalanceView } from '@/lib/credits/balanceView'
import { canSeeCreditBalance } from '@/lib/credits/config'
import { purchaseLinkAgency } from '@/lib/credits/purchaseLink'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'
import { getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'
import { isAdmin } from '@/types/roles'

/**
 * The page the WhatsApp purchase link opens. It lives OUTSIDE the (app) layout on
 * purpose, like /billing/success: that layout sends phones to /activate, and this
 * link is opened from WhatsApp, on a phone. A session is required and a purchase
 * is only ever for the session's own agency.
 */
export default async function CreditsPageContent({ searchParams }: { searchParams?: Promise<{ credits?: string | string[] }> }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const allowed = isAdmin(user.role) && canSeeCreditBalance(user.agencyId)
  const linkAgency = purchaseLinkAgency((await searchParams)?.credits)
  return (
    <I18nProvider locale={locale} persistLocale={false}>
      <main {...regionAttrs(locale)} className='mx-auto w-full max-w-3xl px-4 pb-10'>
        {allowed ? <CreditBalance view={await getCreditBalanceView(user.agencyId)} locale={locale} linkMismatch={linkAgency !== null && linkAgency !== user.agencyId} /> : <p className='mt-10 text-sm text-gray-700'>{t('settings.account.denied')}</p>}
      </main>
    </I18nProvider>
  )
}
