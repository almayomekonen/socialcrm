'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'

type Props = {
  fallbackLabel: string
  hint: 'attachments' | 'general'
}

const GENERAL_STATES = ['מנתח את הקשר הליד', 'סוקר פעילות אחרונה', 'מגבש תשובה']
const ATTACHMENT_STATES = ['קורא את הקובץ המצורף', 'מנתח את תוכן המסמך', 'מחלץ מידע מהקובץ', 'מגבש תשובה']

const CYCLE_MS = 2400

export default function ActiveGenerationRow({ fallbackLabel, hint }: Props) {
  const states = hint === 'attachments' ? ATTACHMENT_STATES : GENERAL_STATES
  const [idx, setIdx] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setIdx(0)
    intervalRef.current = setInterval(() => {
      setIdx((prev) => {
        const next = prev + 1
        if (next >= states.length) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return prev
        }
        return next
      })
    }, CYCLE_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [states])

  const label = states[idx] ?? fallbackLabel

  return (
    <div
      className='flex items-center gap-2 px-1 py-2 text-[12.5px] text-gray-500'
      role='status'
      aria-live='polite'
    >
      <span className='cp-spark inline-flex items-center justify-center shrink-0'>
        <Icon name='sparkles' type='reg' className='size-3.5 bg-gray-500' />
      </span>
      <span key={idx} className='cp-spark-text truncate'>
        {label}
      </span>
    </div>
  )
}
