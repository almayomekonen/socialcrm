'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error('error page: ', error)

  useEffect(() => {
    console.error('useEffect error page: ', error)
  }, [error])

  return (
    <div className='abs-center text-2xl text-red-600 font-bold'>
      <h2 className='mb-4'>חלה שגיאה במערכת</h2>
      <button onClick={() => reset()}>נסה שנית</button>
    </div>
  )
}
