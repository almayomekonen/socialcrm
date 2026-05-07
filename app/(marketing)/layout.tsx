import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import Footer4Col from '@/components/ui/footer-column'

export default async function MarketingLayout({ children }) {
  const user = await getUser()
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <MarketingNavbar isAuthenticated={Boolean(user)} />
      <Suspense>
        <div>{children}</div>
      </Suspense>
      <Footer4Col />
    </div>
  )
}
