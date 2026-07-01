'use client'

import { useEffect, useRef, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { startTrial, trackWelcomeModalSeen } from '@/actions/trial'

// Must match the `desktop` breakpoint in tailwind.config.ts — the system's
// definition of "can use the CRM" (MobileBlock hides at exactly this width).
const DESKTOP_QUERY = '(min-width: 1000px)'

const FEATURES = [
  'כל הלידים במקום אחד',
  'וואטסאפ, משימות, יומן וקבצים',
  'גישה מלאה לכל המערכת',
  'ללא צורך בכרטיס אשראי',
]

/**
 * Shown while trial status is NEVER_STARTED, on desktop viewports only.
 * The viewport gate MUST be this JS check, not CSS: ModalPop portals at
 * z-99999, above MobileBlock's z-9999, so CSS hiding would be too late.
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
      <div ref={dialogRef} className='flex flex-col gap-5 min-w-[340px] max-w-[420px] pt-2'>
        <div>
          <h2 id='welcome-trial-title' className='text-xl font-bold leading-snug'>
            החשבון שלך מוכן
          </h2>
          <p id='welcome-trial-subtitle' className='text-sm text-gray-600 mt-2'>
            7 ימי ניסיון מלאים מתחילים עכשיו
          </p>
        </div>

        <div className='bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col gap-2.5'>
          {FEATURES.map((item) => (
            <div key={item} className='flex items-center gap-2.5'>
              <span className='flex size-5 items-center justify-center rounded-full flex-none bg-emerald-100 border border-emerald-300'>
                <Icon name='check' className='size-2.5 bg-emerald-600' />
              </span>
              <span className='text-sm'>{item}</span>
            </div>
          ))}
        </div>

        {error && (
          <p className='text-sm text-red-500' role='alert'>
            {error}
          </p>
        )}

        <Btn variant='solid' size='large' lbl={pending ? 'רק רגע...' : 'התחל לעבוד'} onClick={onStart} disabled={pending} />
      </div>
    </ModalPop>
  )
}
