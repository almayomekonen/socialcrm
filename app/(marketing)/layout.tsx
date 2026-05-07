import { Suspense } from 'react'

export default function MarketingLayout({ children }) {
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <Suspense>
        <div>{children}</div>
      </Suspense>
    </div>
  )
}
