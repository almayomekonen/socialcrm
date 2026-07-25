'use client'

import { useEffect, useRef, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import Icon, { type IconNames } from '@/lib/Icon'
import { startTrial, trackWelcomeModalSeen } from '@/actions/trial'

// Must match the `desktop` breakpoint in tailwind.config.ts — the system's
// definition of "can use the CRM" on desktop viewports.
const DESKTOP_QUERY = '(min-width: 1000px)'

// One-time Pro activation benefits, shown as a 2×2 grid. Distinct existing
// icons only — no new icon library.
const BENEFITS: { icon: IconNames; title: string; sub: string }[] = [
  { icon: 'comment-dots', title: 'כל הלידים והשיחות', sub: 'הכול במקום אחד' },
  { icon: 'brain', title: 'AI חכם ומתקדם', sub: 'כל יכולות ה־AI פתוחות' },
  { icon: 'calendar', title: 'כל כלי העבודה שלך', sub: 'וואטסאפ, משימות, יומן וקבצים' },
  { icon: 'gem', title: 'Pro מלא ל־7 ימים', sub: 'כל יכולות ה־Pro פתוחות עבורך' },
]

/**
 * Shown while trial status is NEVER_STARTED, on desktop viewports only.
 * Mobile users are redirected to /activate by the (app) layout and never reach
 * this surface; the JS viewport check is a belt-and-suspenders guard for narrow
 * desktop windows.
 * Non-dismissible by design — the only way through is the CTA, which is the
 * single trigger that starts the trial. Because it is non-dismissible, the
 * dialog traps keyboard focus itself (ModalPop has no trap of its own).
 */
export default function WelcomeTrialModal() {
  const [isDesktop, setIsDesktop] = useState(false)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seenRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const open = isDesktop && !done

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!open || seenRef.current) return
    seenRef.current = true
    trackWelcomeModalSeen().catch(() => {})
  }, [open])

  // Initial focus + focus trap. ModalPop mounts its portal one effect-tick
  // after `open` flips, so the initial focus retries via rAF until the
  // dialog exists in the DOM.
  useEffect(() => {
    if (!open) return
    let raf = 0
    const focusables = () => {
      const dialog = dialogRef.current
      if (!dialog) return []
      return Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"))
    }
    const tryInitialFocus = () => {
      const els = focusables()
      if (els.length > 0) els[0].focus()
      else raf = requestAnimationFrame(tryInitialFocus)
    }
    tryInitialFocus()

    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      const els = focusables()
      if (!dialog || els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeydown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeydown)
    }
  }, [open])

  async function onStart() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await startTrial()
      if ('error' in res) {
        setError('אירעה שגיאה, נסה שוב')
        setPending(false)
        return
      }
      setDone(true)
    } catch {
      setError('אירעה שגיאה ברשת, נסה שוב')
      setPending(false)
    }
  }

  return (
    <ModalPop open={open} pos='middle' onClose={() => {}} hideClose labelledBy='welcome-trial-title' describedBy='welcome-trial-subtitle'>
      <div ref={dialogRef} className='flex flex-col gap-6 w-full max-w-[640px]'>
        {/* Header: premium pill → headline → supporting → restrained trust copy */}
        <div className='flex flex-col items-center text-center gap-2.5'>
          <span className='inline-block rounded-full bg-dark text-white text-[10px] font-bold tracking-[0.12em] px-2.5 py-1 select-none'>
            SOCIALCRM PRO
          </span>
          <h2 id='welcome-trial-title' className='text-2xl font-bold leading-snug'>
            ה־SocialCRM Pro שלך מוכן
          </h2>
          <p id='welcome-trial-subtitle' className='text-sm text-gray-600'>
            7 ימים עם כל המערכת פתוחה עבורך
          </p>
          <p className='text-xs text-gray-400'>ללא עלות · ללא כרטיס אשראי</p>
        </div>

        {/* 2×2 benefit grid — distinct icon tiles */}
        <div className='grid grid-cols-2 gap-3'>
          {BENEFITS.map((b) => (
            <div key={b.title} className='flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3'>
              <span className='flex size-9 items-center justify-center rounded-lg flex-none bg-primary-tint'>
                <Icon name={b.icon} type='reg' className='size-4 bg-primary' />
              </span>
              <div className='min-w-0'>
                <p className='text-sm font-semibold text-gray-900 leading-tight'>{b.title}</p>
                <p className='text-xs text-gray-500 leading-snug mt-0.5'>{b.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p className='text-sm text-red-500 text-center' role='alert'>
            {error}
          </p>
        )}

        {/* Dominant, full-width primary action — the ONLY trial trigger */}
        <Btn
          variant='solid'
          size='large'
          className='w-full justify-center'
          lbl={pending ? 'רק רגע...' : 'הפעל את ה-Pro שלי'}
          onClick={onStart}
          disabled={pending}
        />

        <p className='text-xs text-gray-400 text-center -mt-2'>
          7 ימים ללא עלות · ללא כרטיס אשראי · לאחר מכן תוכל לבחור אם להמשיך
        </p>
      </div>
    </ModalPop>
  )
}
