import { Suspense } from 'react'

// Mirrors the (auth) layout: the consent page reads the session and the pending
// cookie, so it renders under a Suspense boundary (cacheComponents), and this
// layout owns the route's single <main> landmark.
export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang='he' dir='rtl'>
      <Suspense>
        <main>{children}</main>
      </Suspense>
    </div>
  )
}
