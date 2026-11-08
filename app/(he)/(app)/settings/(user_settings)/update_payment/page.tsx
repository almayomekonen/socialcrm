import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { isAdmin } from '@/types/roles'
import { getAgencyPlan } from '@/lib/quota'
import { getPlanUsage } from '@/lib/quota/planUsage'
import { getSubscriptionView } from '@/lib/quota/subscription'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import Packages from '@/components/settings/payment/Packages'
import ProPlanCard from '@/components/settings/payment/ProPlanCard'
import SubscriptionUsage from '@/components/settings/payment/SubscriptionUsage'
import BillingHistory from '@/components/settings/payment/BillingHistory'
import CreditBalance from '@/components/settings/payment/CreditBalance'
import { canSeeCreditBalance } from '@/lib/credits/config'
import { purchaseLinkAgency } from '@/lib/credits/purchaseLink'
import { listPaidCreditPacks } from '@/db/credits/purchases'
import { mergeChargeHistory } from '@/lib/credits/chargeHistory'
import { getCreditBalanceView } from '@/lib/credits/balanceView'
import TrialStatusCard from '@/components/trial/TrialStatusCard'
import CardOnFileSummary from '@/components/trial/CardOnFileSummary'
import { getCardTrialView } from '@/lib/payments/cardTrial/cardTrialView'
import Icon from '@/lib/Icon'
import { PRICING } from '@/lib/pricing'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { isCardBillingAvailable, billingSetupPurpose, describeCardBillingAvailability } from '@/lib/payments/cardTrial/availability'
import PlanStatusBox from '@/components/settings/payment/PlanStatusBox'
import { refreshCardSetupState } from '@/lib/payments/cardTrial/recoverCardSetup'
import CardTrialSetupForm from '@/components/trial/CardTrialSetupForm'
import PaymentsUnavailableNotice from '@/components/billing/PaymentsUnavailableNotice'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

type SearchParams = Promise<{ mode?: string | string[]; credits?: string | string[] }>

/**
 * Settings → מנוי ותשלום. Two audiences, one route.
 *
 * A SUBSCRIBER gets a billing centre (design round 7b): plan, renewal, usage,
 * invoices, payment method, trust note — and nothing that sells. The חבילות
 * comparison, the Free card and the upgrade CTA are deliberately absent for
 * them; they already bought, and re-pitching a paying customer is the upsell
 * wearing a helpful costume that care-charter §12 rules out.
 *
 * A FREE OR TRIALLING agency still needs somewhere to subscribe, and חבילות is
 * the only surface that offers it — the trial card's "בחר מסלול להמשך" anchors
 * to #packages further down this same page. So the section is gated on
 * `!isPro` rather than deleted: removing it for everyone would not be polish,
 * it would delete the product's checkout.
 *
 * Everything the subscriber sees is counted or stored, never derived. Card
 * digits, per-charge amounts and invoice documents are absent because this
 * system does not record them — see PaymentMethodRow and BillingHistory.
 */
/** One label per purpose: the button says exactly what pressing it does. */
/**
 * `card_update` reaches THIS page only when there is no card on file — the page
 * computes no purpose at all once `cardBilled` is true, and replacement lives
 * in CardBillingControls. So here it always means "add a first card", and
 * "החלפת הכרטיס השמור" would name a card that does not exist.
 */
const SETUP_LABEL: Record<'trial_start' | 'reactivate' | 'card_update', MessageKey> = {
  trial_start: 'settings.payment.setup.trial_start',
  reactivate: 'settings.payment.setup.reactivate',
  card_update: 'settings.payment.setup.card_update',
}

export default async function page({ searchParams }: { searchParams?: SearchParams }) {
  const sp = searchParams ? await searchParams : {}
  const isLocalMode = sp.mode === 'local'

  const user = await getUser()
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  /**
   * The nav entry for this page sits inside the `role == 'ADMIN'` block, so it
   * was hidden from other roles — but hidden is not denied. The page itself had
   * no role check, and a direct URL rendered the agency's plan, usage and
   * billing history to any authenticated user. `isAdmin` is the predicate the
   * subscription actions use, so page and action now agree.
   */
  if (!user || !isAdmin(user.role)) {
    return <div {...regionAttrs(locale)}>{t('settings.account.denied')}</div>
  }
  const productAccess = await getAgencyProductAccess(user.agencyId)
  const plan = await getAgencyPlan(user.agencyId)
  const isPro = plan === 'pro'
  const subscription = isPro ? await getSubscriptionView(user.agencyId) : null

  /*
   * Finish a save whose callback already arrived BEFORE deciding what to show.
   *
   * Without this the page read a stale row: agency 103 saved a card, the
   * callback was recorded, the evidence gate was shut at that moment, and the
   * row stayed 'pending'. The only thing that ever asked again was the Grow
   * return page's poll, so coming back here showed the add-a-card form — which
   * reads as "it didn't work" and invites a second entry that supersedes the
   * first. Same verified idempotent path as that poll; it forges nothing and
   * activates nothing the provider has not confirmed.
   */
  await refreshCardSetupState(user.agencyId)

  // Card-token billing facts (empty for every Payment-Link or no-card agency).
  const cardView = await getCardTrialView(user.agencyId)
  const trialRow = isPro ? null : await getAgencyTrial(user.agencyId)
  const trial = trialRow ? getTrialState(trialRow, new Date()) : null
  const trialActive = trial?.status === 'TRIAL_ACTIVE'

  const subscriptionCharges = await db('payments')
    .where({ agencyId: user.agencyId })
    .orderBy('createdAt', 'desc')
    .select('id', 'transactionId', 'createdAt')
  const charges = mergeChargeHistory(subscriptionCharges, await listPaidCreditPacks(user.agencyId))

  // Usage only describes a subscription, so it is read only when there is one.
  const usage = isPro ? await getPlanUsage(user.agencyId, plan) : null
  const creditBalance = canSeeCreditBalance(user.agencyId) ? await getCreditBalanceView(user.agencyId) : null
  const linkAgency = purchaseLinkAgency(sp.credits)
  const creditLinkMismatch = linkAgency !== null && linkAgency !== user.agencyId

  // The only way to pay is a saved card. Offer a setup only when the provider
  // can actually complete one AND this agency is eligible for some purpose —
  // otherwise say so plainly instead of rendering a button that leads nowhere.
  const setupPurpose = cardView.cardBilled ? null : await billingSetupPurpose(user.agencyId)
  const availability = describeCardBillingAvailability()
  const canStartSetup = availability.ok && setupPurpose !== null

  /**
   * When the screen is about to say "not right now", say WHY in the log.
   *
   * Booleans and condition codes only — no credential, token or card data. This
   * exists because production showed the notice and logged nothing, so the
   * cause could not be told apart from a missing variable without guessing.
   */
  if (!canStartSetup) {
    console.warn('[CardSetup] setup not offered', {
      agencyId: user.agencyId,
      providerAvailable: availability.ok,
      providerReason: availability.reason,
      trialStatus: trial?.status ?? null,
      alreadyCardBilled: cardView.cardBilled,
      setupPurpose,
    })
  }

  // Amounts and the recorded terms are passed / kept as they are; only the chrome follows the interface.
  const monthly = `₪${PRICING.monthly}`
  return (
    <div {...regionAttrs(locale)}>
      <h1 className='title mb-8'>{t('settings.account.title.billing')}</h1>

      {isLocalMode && (
        <div
          role='status'
          dir={locale === 'he' ? 'rtl' : undefined}
          className='mb-6 max-w-3xl p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3'
        >
          <Icon name='circle-exclamation' className='bg-amber-700 size-5 mt-0.5 shrink-0' />
          <div className='space-y-1 text-sm'>
            <p className='font-semibold text-amber-900'>{t('settings.payment.devMode.title')}</p>
            <p className='text-amber-800'>{t('settings.payment.devMode.line1')}</p>
            <p className='text-amber-800'>{t('settings.payment.devMode.line2')}</p>
          </div>
        </div>
      )}

      {cardView.cardBilled && <CardOnFileSummary view={cardView} granted={subscription?.source === 'grant'} locale={locale} />}

      {trialActive && trial?.endsAt && trialRow?.trialStartedAt && (
        <TrialStatusCard
          startedAt={new Date(trialRow.trialStartedAt)}
          endsAt={trial.endsAt}
          daysRemaining={trial.daysRemaining ?? 0}
          cardBilled={cardView.cardBilled}
          cancelAtPeriodEnd={cardView.cancelAtPeriodEnd}
          locale={locale}
        />
      )}

      {isPro && subscription ? (
        <>
          {/* Named first so the truth is the first thing read on the page. */}
          {!productAccess.hasAccess && (
            <div className='mb-6 max-w-3xl'>
              <SubscriptionExpiredState mode='inline' source='billing_page' translated />
            </div>
          )}
          <ProPlanCard subscription={subscription} hasAccess={productAccess.hasAccess} locale={locale} />
        </>
      ) : (
        <PlanStatusBox trialActive={trialActive} canAddFirstCard={!cardView.cardBilled} locale={locale} />
      )}

      {usage && <SubscriptionUsage usage={usage} locale={locale} />}
      {/* Usage credits: shown only to allowlisted agencies (CREDITS_UI / CREDITS_PURCHASES). */}
      {creditBalance && <CreditBalance view={creditBalance} locale={locale} linkMismatch={creditLinkMismatch} />}

      <BillingHistory charges={charges} locale={locale} />

      {!cardView.cardBilled && (
        <section id='card-setup' className='mt-12 scroll-mt-6'>
          <h2 className='text-xl font-bold'>{t('settings.payment.method.title')}</h2>
          <p className='mt-1 text-sm text-gray-500'>
            {subscription?.source === 'grant'
              ? t('settings.payment.method.grantNote')
              : t('settings.payment.method.subscriptionNote', { amount: monthly })}
          </p>
          <div className='mt-4'>
            {canStartSetup && setupPurpose ? (
              <CardTrialSetupForm
                purpose={setupPurpose}
                /* Entitled already, adding a first card: no trial, no ₪89, and
                   no subscription consent — none of them are true here. */
                mode={setupPurpose === 'card_update' ? 'entitled' : 'subscription'}
                submitLabel={t(SETUP_LABEL[setupPurpose])}
                translated
              />
            ) : (
              <PaymentsUnavailableNotice action='start' hasAccess={productAccess.hasAccess} locale={locale} />
            )}
          </div>
        </section>
      )}

      {!isPro && (
        <>
          <h2 id='packages' className='text-xl font-bold mt-12 scroll-mt-6'>
            {t('settings.payment.packagesTitle')}
          </h2>
          <Packages plan={plan} trialActive={trialActive} cardBilled={cardView.cardBilled} />
        </>
      )}

      <div className='mt-10 flex max-w-3xl items-center gap-2.5 text-xs text-gray-500'>
        <Icon name='lock' type='reg' className='size-3.5 shrink-0 bg-gray-400' />
        {t('settings.payment.secureNote')}
      </div>
    </div>
  )
}
