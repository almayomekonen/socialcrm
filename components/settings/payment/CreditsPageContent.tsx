import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { lastBlockedQuestion } from '@/db/credits/agentRequests'
import PaymentsUnavailableNotice from '@/components/billing/PaymentsUnavailableNotice'
import CreditBalance from '@/components/settings/payment/CreditBalance'
import CreditPurchaseStatus from '@/components/settings/payment/CreditPurchaseStatus'
import CardTrialSetupForm from '@/components/trial/CardTrialSetupForm'
import { getCreditBalanceView } from '@/lib/credits/balanceView'
import { canSeeCreditBalance } from '@/lib/credits/config'
import { purchaseLinkAgency } from '@/lib/credits/purchaseLink'
import { whatsappReturnHref } from '@/lib/credits/purchaseOutcome'
import { platformWhatsappWaMeNumber } from '@/lib/flags/ownerWhatsappReminderFlags'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'
import { getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'
import { describeCardBillingAvailability } from '@/lib/payments/cardTrial/availability'
import { refreshCardSetupState } from '@/lib/payments/cardTrial/recoverCardSetup'
import { isCardSetupEligible } from '@/lib/payments/cardTrial/startCardSetup'
import { isAdmin } from '@/types/roles'

/**
 * The page the WhatsApp purchase link opens. It lives OUTSIDE the (app) layout on
 * purpose, like /billing/success: that layout sends phones to /activate, and this
 * link is opened from WhatsApp, on a phone. A session is required and a purchase
 * is only ever for the session's own agency.
 *
 * No saved card: Grow's existing hosted save, returning here. Saved card: the
 * packs. Everything about a purchase's result is read from the server.
 */
export default async function CreditsPageContent({ searchParams }: { searchParams?: Promise<{ credits?: string | string[] }> }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  if (!isAdmin(user.role) || !canSeeCreditBalance(user.agencyId)) {
    return <main {...regionAttrs(locale)} className='mx-auto w-full max-w-3xl px-4 pb-10'><p className='mt-10 text-sm text-gray-700'>{t('settings.account.denied')}</p></main>
  }
  // A card whose verified callback already arrived, after a closed browser, counts as saved.
  await refreshCardSetupState(user.agencyId)
  const view = await getCreditBalanceView(user.agencyId)
  const linkAgency = purchaseLinkAgency((await searchParams)?.credits)
  const linkMismatch = linkAgency !== null && linkAgency !== user.agencyId
  const needsCard = view.packs.length > 0 && !linkMismatch && (!view.hasCard || view.cardDeclined)
  const canAddCard = needsCard && describeCardBillingAvailability().ok && (await isCardSetupEligible(user.agencyId, 'card_update'))
  const draft = view.latestPurchase?.state === 'success' ? await lastBlockedQuestion(user.agencyId, user.id) : null
  const cardSetup = !needsCard ? null : canAddCard ? (
    <div className='mt-2 flex flex-col gap-3'>
      <p className='text-sm text-gray-700'>{t('settings.payment.credits.addCard')}</p>
      <CardTrialSetupForm purpose='card_update' mode='entitled' returnTo='credits' submitLabel={t('settings.payment.setup.card_update')} translated />
    </div>
  ) : (
    <PaymentsUnavailableNotice action='start' hasAccess locale={locale} />
  )
  return (
    <I18nProvider locale={locale} persistLocale={false}>
      <main {...regionAttrs(locale)} className='mx-auto w-full max-w-3xl px-4 pb-10'>
        <CreditPurchaseStatus outcome={view.latestPurchase} whatsappHref={whatsappReturnHref(platformWhatsappWaMeNumber(), draft)} hasCredits={view.purchasedAvailable >= 1} locale={locale} />
        <CreditBalance view={view} locale={locale} linkMismatch={linkMismatch} cardSetup={cardSetup} />
      </main>
    </I18nProvider>
  )
}
