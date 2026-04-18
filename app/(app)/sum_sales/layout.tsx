import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import SumSalesNav from '@/components/sumSales/SumSalesNav'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'דוחות',
  description: 'דוחות עסקאות',
}

export default async function SumSalesLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  return (
    <div>
      <h1 className='title'>דוחות</h1>
      <Suspense fallback={null}>
        <SumSalesNav user={user} />
      </Suspense>
      {children}
    </div>
  )
}
