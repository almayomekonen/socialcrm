import { Suspense } from 'react'

export default function AuthLayout({ children }) {
  return (
    <div lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <Suspense>
        <main>{children}</main>
      </Suspense>
    </div>
  )
}
