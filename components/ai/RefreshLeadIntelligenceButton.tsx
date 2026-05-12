'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { refreshLeadIntelligence } from '@/actions/ai/leadIntelligenceRefresh'

type Props = {
  leadId: number | string
}

export default function RefreshLeadIntelligenceButton({ leadId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(t)
  }, [message])

  function onClick() {
    startTransition(async () => {
      const res = await refreshLeadIntelligence(leadId)
      if (res.ok === true) {
        setMessage(null)
        router.refresh()
        return
      }
      if (res.reason === 'rate-limited') {
        setMessage('נסה שוב בעוד דקה')
      } else {
        setMessage('לא ניתן לרענן כרגע')
      }
    })
  }

  return (
    <div className='flex items-center gap-2'>
      {message && <span className='text-[11px] text-gray-400'>{message}</span>}
      <button
        type='button'
        onClick={onClick}
        disabled={isPending}
        className='text-[11px] text-gray-500 hover:text-gray-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors'
      >
        {isPending ? 'מרענן…' : 'רענן תובנות'}
      </button>
    </div>
  )
}
