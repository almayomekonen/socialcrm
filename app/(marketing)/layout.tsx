import { Suspense } from 'react'
import Footer4Col from '@/components/ui/footer-column'

export default function MarketingLayout({ children }) {
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <Suspense>
        <div>{children}</div>
      </Suspense>
      <Footer4Col />
    </div>
  )
}
