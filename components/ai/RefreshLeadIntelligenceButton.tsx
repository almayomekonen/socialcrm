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
      {/*
        `tap-44` (A2a-2). Measured at 47.8 × 16.5px on every phone width — 16.5px
        is 37% of the 44px minimum, on a control that sits inside the mobile lead
        detail. The class extends the HIT AREA with an `::after` pseudo-element
        (`width/height: max(100%, 44px)`) and leaves the drawn control exactly as
        it is, which is the whole reason it exists: the label stays 11px and
        desktop renders pixel-identically.

        Coarse-pointer only by construction — the rule lives inside
        `@media (pointer: coarse)` in `lib/css/main.css`, so a mouse-driven
        desktop never gets the pseudo-element at all.
      */}
      <button
        type='button'
        onClick={onClick}
        disabled={isPending}
        className='tap-44 text-[11px] text-gray-500 hover:text-gray-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors'
      >
        {isPending ? 'מרענן…' : 'רענן תובנות'}
      </button>
    </div>
  )
}
