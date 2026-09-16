import type { Metadata } from 'next'
import BillingActivationVerifier from '@/components/billing/BillingActivationVerifier'
import CardSetupVerifier from '@/components/billing/CardSetupVerifier'

export const metadata: Metadata = { title: 'התשלום בוצע' }

/** Grow sends the customer back here; `source` says which flow they came from. */
const CARD_SOURCES = { card_trial: 'card_trial', card_update: 'card_update', reactivate: 'reactivate' } as const
type CardSource = keyof typeof CARD_SOURCES

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
 */
export default async function BillingSuccessPage({ searchParams }: { searchParams?: Promise<{ source?: string | string[] }> }) {
  const sp = searchParams ? await searchParams : {}
  const raw = Array.isArray(sp.source) ? sp.source[0] : sp.source
  const cardSource = raw && raw in CARD_SOURCES ? (raw as CardSource) : null

  return (
    <main className='min-h-screen flex items-center justify-center bg-gray-50 px-4'>
      {cardSource ? <CardSetupVerifier purpose={cardSource} /> : <BillingActivationVerifier />}
    </main>
  )
}
