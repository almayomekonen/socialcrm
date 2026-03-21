import { getUser } from '@/db/auth'
import SumSalesNav from '@/components/sumSales/SumSalesNav'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'דוחות',
  description: 'דוחות דילים ועסקאות',
}

export default async function SumSalesLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  return (
    <div>
      <h1 className='title'>דוחות</h1>
      <SumSalesNav user={user} />
      {children}
    </div>
  )
}
