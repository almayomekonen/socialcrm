import { Suspense } from 'react'
import CreditsPageContent from '@/components/settings/payment/CreditsPageContent'

/** Request-time (session, query string), so it renders inside Suspense. See CreditsPageContent. */
export default function CreditsPage(props: { searchParams?: Promise<{ credits?: string | string[] }> }) {
  return (
    <Suspense fallback={<main className='mx-auto w-full max-w-3xl px-4 pb-10' />}>
      <CreditsPageContent {...props} />
    </Suspense>
  )
}
