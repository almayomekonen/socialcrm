'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export default function LeadsTabs() {
  const searchParams = useSearchParams()
  const closed = searchParams.get('closed') === 'true'

  return (
    <div className='flex gap-1 bg-gray-100 rounded-lg p-1 text-sm font-medium'>
      <Link
        href='/leads'
        className={`px-4 py-1.5 rounded-md transition-colors ${!closed ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
      >
        פעילים
      </Link>
      <Link
        href='/leads?closed=true'
        className={`px-4 py-1.5 rounded-md transition-colors ${closed ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
      >
        סגורים
      </Link>
    </div>
  )
}
