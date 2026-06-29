import { Suspense } from 'react'

// Mirrors the (auth)/(marketing) layouts: the page reads per-user data (cookies,
// onboarding flag), so it must render under a Suspense boundary — otherwise the
// build's prerender rejects it as a blocking route.
export default function ActivateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang='he' dir='rtl'>
      <Suspense>{children}</Suspense>
    </div>
  )
}
