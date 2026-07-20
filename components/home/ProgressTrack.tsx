'use client'

import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '@/lib/copilot/hooks/usePrefersReducedMotion'

/**
 * Number-forward progress (Vercel/Stripe language, not a fitness ring).
 * The handled count is the hero; a slim track eases to width on mount and the
 * number counts up — both once, and both skipped entirely under reduced-motion.
 * Props-only: all values are computed server-side, so there is no client Date()
 * and no hydration mismatch. 100% real work — no goals, no gamification.
 */
export default function ProgressTrack({
  doneToday,
  progressTotal,
  pct,
  remaining,
}: {
  doneToday: number
  progressTotal: number
  pct: number
  remaining: number
}) {
  const reduced = usePrefersReducedMotion()
  const [width, setWidth] = useState(0)
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (reduced) {
      setWidth(pct)
      setCount(doneToday)
      return
    }
    const rafWidth = requestAnimationFrame(() => setWidth(pct))
    const start = performance.now()
    const duration = 600
    let rafCount = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      setCount(Math.round(doneToday * p))
      if (p < 1) rafCount = requestAnimationFrame(tick)
    }
    rafCount = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafWidth)
      cancelAnimationFrame(rafCount)
    }
  }, [reduced, pct, doneToday])

  const caption =
    progressTotal === 0 ? 'אין מעקבים פתוחים' : remaining === 0 ? 'סיימת להיום' : `עוד ${remaining} והרשימה נקייה`

  return (
    <div className='mt-6'>
      <div className='flex items-baseline justify-between'>
        <span className='text-sm font-medium text-gray-500'>טופלו היום</span>
        <span className='text-sm text-gray-400 tabular-nums'>{pct}%</span>
      </div>
      <div className='mt-1.5 flex items-baseline gap-1.5'>
        <span className='text-4xl font-semibold leading-none text-ink tabular-nums'>{count}</span>
        <span className='text-lg leading-none text-gray-400 tabular-nums'>/ {progressTotal}</span>
      </div>
      <div className='mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100'>
        <div
          className='h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none'
          style={{ width: `${width}%` }}
        />
      </div>
      <p className='mt-2.5 text-sm text-gray-500'>{caption}</p>
    </div>
  )
}
