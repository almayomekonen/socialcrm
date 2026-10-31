import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import CardSetupVerifier from '@/components/billing/CardSetupVerifier'
import { getPreLoginLocale } from '@/lib/i18n/preLoginServer'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Language: the `ui_locale` display hint the signed-in app leaves for pilot
 * users (Phase F4's mechanism, `getPreLoginLocale`), honoured only while
 * UI_LOCALE_ENABLED is on — no session read is added to the card return. The
 * route was already request-time (it reads `source` inside Suspense).
 */
export async function generateMetadata(): Promise<Metadata> {
  return { title: translatorFor(await getPreLoginLocale())('trial.verifier.pageTitle') }
}

/** Grow sends the customer back here; `source` says which flow they came from. */
const CARD_SOURCES = { card_trial: 'card_trial', card_update: 'card_update', reactivate: 'reactivate' } as const
type CardSource = keyof typeof CARD_SOURCES

/**
 * Reading `source` is what makes this route dynamic, so it sits behind the
 * page's <Suspense> boundary: the shell still prerenders, and the Cache
 * Components build does not fail on uncached data.
 *
 * A visit WITHOUT a recognised source is a stale bookmark from the retired
 * Payment Link flow. It goes to the billing screen. It must not render the
 * verifier, which would sit "checking" for thirty seconds over a setup that was
 * never started, and it must certainly not imply that anything was paid.
 */
async function ReturnedFlow({ searchParams }: { searchParams?: Promise<{ source?: string | string[] }> }) {
  const sp = searchParams ? await searchParams : {}
  const raw = Array.isArray(sp.source) ? sp.source[0] : sp.source
  const cardSource = raw && raw in CARD_SOURCES ? (raw as CardSource) : null
  if (!cardSource) redirect('/settings/update_payment')

  return <CardSetupVerifier purpose={cardSource} locale={await getPreLoginLocale()} />
}

/**
 * The page is a shell; the state lives in the verifier.
 *
 * The `<meta http-equiv="refresh" content="5;url=…">` that used to sit here is
 * gone on purpose. It announced success on a stopwatch and bounced the customer
 * into settings whether or not anything had been activated, which is precisely
 * how a paid customer ended up looking at an expired product. The verifier asks
 * the server instead, and only says "הופעל" once the server agrees.
 *
 * This return is a card SETUP, never a payment: the card is saved here and
 * charged later, so nothing on this page may say a charge happened.
 *
 * The fallback deliberately says nothing about the outcome: it is on screen
 * before the verifier has asked the server anything.
 */
export default function BillingSuccessPage({ searchParams }: { searchParams?: Promise<{ source?: string | string[] }> }) {
  return (
    <main className='min-h-screen flex items-center justify-center bg-gray-50 px-4'>
      <Suspense fallback={<div className='h-40 w-full max-w-md' aria-busy='true' />}>
        <ReturnedFlow searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
