import { Suspense } from 'react'
import type { Metadata } from 'next'
import BillingActivationVerifier from '@/components/billing/BillingActivationVerifier'
import CardSetupVerifier from '@/components/billing/CardSetupVerifier'

export const metadata: Metadata = { title: 'התשלום בוצע' }

/** Grow sends the customer back here; `source` says which flow they came from. */
const CARD_SOURCES = { card_trial: 'card_trial', card_update: 'card_update', reactivate: 'reactivate' } as const
type CardSource = keyof typeof CARD_SOURCES

/**
 * Reading `source` is what makes this route dynamic, so it sits behind the
 * page's <Suspense> boundary: the shell still prerenders, and the Cache
 * Components build does not fail on uncached data. It did fail on exactly this
 * page — the first preview build of this branch died here.
 */
async function ReturnedFlow({ searchParams }: { searchParams?: Promise<{ source?: string | string[] }> }) {
  const sp = searchParams ? await searchParams : {}
  const raw = Array.isArray(sp.source) ? sp.source[0] : sp.source
  const cardSource = raw && raw in CARD_SOURCES ? (raw as CardSource) : null

  return cardSource ? <CardSetupVerifier purpose={cardSource} /> : <BillingActivationVerifier />
}

/**
 * The page is a shell; the state lives in the verifiers.
 *
 * The `<meta http-equiv="refresh" content="5;url=…">` that used to sit here is
 * gone on purpose. It announced success on a stopwatch and bounced the customer
 * into settings whether or not the subscription had been activated, which is
 * precisely how a paid customer ended up looking at an expired product. The
 * verifiers ask the server instead, and only say "הופעל" once the server agrees.
 *
 * A card-token return (?source=card_trial|card_update|reactivate) is a SETUP,
 * not a payment: it is verified by CardSetupVerifier against our own setup row.
 * Everything else is the Payment-Link entitlement check, unchanged.
 *
 * The fallback deliberately says nothing about the outcome: it is on screen
 * before either verifier has asked the server anything.
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
