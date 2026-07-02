'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { recordOperatorTakeEvent } from '@/actions/analytics/recordOperatorTakeEvent'

type Props = {
  takeId: string
  arm: 'shown' | 'holdout'
  actionMessage: string
  reason: string
  sourceMessageIds: number[]
  stale: boolean
  eventProps: Record<string, unknown>
}

export default function OperatorTakeClient(props: Props) {
  const { takeId, arm, actionMessage, reason, sourceMessageIds, stale, eventProps } = props
  const [dismissed, setDismissed] = useState(false)
  const logged = useRef(false)

  // Impression — once per take per session, both arms. The holdout arm logs
  // 'suppressed' and renders nothing visible: it is the control denominator.
  useEffect(() => {
    if (logged.current) return
    const key = `optake:imp:${takeId}:${arm}`
    if (typeof window !== 'undefined' && sessionStorage.getItem(key)) {
      logged.current = true
      return
    }
    logged.current = true
    if (typeof window !== 'undefined') sessionStorage.setItem(key, '1')
    void recordOperatorTakeEvent(arm === 'shown' ? 'operator_take.rendered' : 'operator_take.suppressed', {
      ...eventProps,
      takeId,
      arm,
    })
  }, [takeId, arm, eventProps])

  if (arm === 'holdout' || dismissed) return null

  const openCitation = () => {
    void recordOperatorTakeEvent('operator_take.citation_opened', { takeId, sourceMessageIds })
    const first = sourceMessageIds[0]
    if (first != null) {
      const el = document.getElementById(`msg-${first}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.classList.add('ring-2', 'ring-blue-400')
      setTimeout(() => el?.classList.remove('ring-2', 'ring-blue-400'), 1600)
    }
  }

  const dismiss = () => {
    setDismissed(true)
    void recordOperatorTakeEvent('operator_take.dismissed', { takeId })
  }

  return (
    <div className={`mx-4 my-2 shrink-0 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-opacity ${stale ? 'opacity-60' : ''}`}>
      <div className='flex items-start justify-between gap-3'>
        <Sparkles aria-hidden className='mt-0.5 size-4 shrink-0 text-accent' />
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-semibold text-gray-900'>{actionMessage}</p>
          {reason ? (
            <button type='button' onClick={openCitation} className='mt-1 text-right text-xs text-blue-600 hover:underline'>
              {reason}
            </button>
          ) : null}
        </div>
        <button type='button' onClick={dismiss} aria-label='הסתר' className='shrink-0 text-xs text-gray-400 hover:text-gray-600'>
          הסתר
        </button>
      </div>
    </div>
  )
}
