import type { Metadata } from 'next'
import BillingActivationVerifier from '@/components/billing/BillingActivationVerifier'

export const metadata: Metadata = { title: 'התשלום בוצע' }

/**
 * The page is now a shell; the state lives in the verifier.
 *
 * The `<meta http-equiv="refresh" content="5;url=…">` that used to sit here is
 * gone on purpose. It announced success on a stopwatch and bounced the customer
 * into settings whether or not the subscription had been activated, which is
 * precisely how a paid customer ended up looking at an expired product. The
 * verifier asks the server instead, and only says "הופעל" once the server
 * agrees.
 */
export default function BillingSuccessPage() {
  return (
    <main className='min-h-screen flex items-center justify-center bg-gray-50 px-4'>
      <BillingActivationVerifier />
    </main>
  )
}
