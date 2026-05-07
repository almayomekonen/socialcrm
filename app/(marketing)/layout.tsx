import { Suspense } from 'react'

export default function GeneralLayout({ children }) {
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <Suspense>
        <div>{children}</div>
      </Suspense>
    </div>
  )
}
