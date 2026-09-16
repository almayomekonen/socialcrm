'use client'

import { useEffect, useRef, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import Icon, { type IconNames } from '@/lib/Icon'
import { startTrial, trackTrialStartClicked, trackTrialStartFailed, trackWelcomeModalSeen } from '@/actions/trial'
import CardTrialSetupForm from './CardTrialSetupForm'
import { trackStartTrial } from '@/lib/facebook/pixelEvents'
import { useActivationCelebration } from './ActivationCelebrationContext'

// One-time Pro activation benefits, shown as a 2×2 grid. Distinct existing
// icons only — no new icon library.
const BENEFITS: { icon: IconNames; title: string; sub: string }[] = [
  { icon: 'comment-dots', title: 'כל הלידים והשיחות', sub: 'הכול במקום אחד' },
  { icon: 'brain', title: 'AI חכם ומתקדם', sub: 'כל יכולות ה־AI פתוחות' },
  { icon: 'calendar', title: 'כל כלי העבודה שלך', sub: 'וואטסאפ, משימות, יומן וקבצים' },
  { icon: 'gem', title: 'Pro מלא ל־7 ימים', sub: 'כל יכולות ה־Pro פתוחות עבורך' },
]

/**
 * Shown whenever trial status is NEVER_STARTED. Device gating is the SERVER's
 * job and the server's alone: the (app) layout redirects phones to /activate
 * (isMobileRequest, lib/device.ts) before this ever renders, per
 * architecture-rules.md §9 — gate by absence, never suppress on the client.
 *
 * This deliberately has no viewport check. The previous `(min-width: 1000px)`
 * guard was redundant with that server redirect and left a real hole: a tablet
 * or a narrow desktop window passes the UA-based layout gate but failed the
 * viewport check, so the modal never opened, startTrial() was unreachable, and
 * the agency sat in the product silently capped at FREE_LEAD_LIMIT with no way
 * out. Reaching this surface at all now means the trial is startable.
 *
 * Non-dismissible by design — the only way through is the CTA, which is the
 * single trigger that starts the trial. Because it is non-dismissible, the
 * dialog traps keyboard focus itself (ModalPop has no trap of its own).
 */
/**
 * `cardSetup` present ⇒ the card-required variant (CARD_REQUIRED_TRIAL_ENABLED,
 * resolved on the SERVER in the (app) layout). The trial then starts only after
 * Grow's callback is verified, so this variant never calls startTrial().
 */
export type WelcomeCardSetup = {
  defaultFullName: string
  canManageBilling: boolean
  /**
   * 'setup' offers the form. 'awaiting' means a card is already saved and being
   * verified — the account is not activated and must not be told otherwise, and
   * must not be handed the form again (a second setup supersedes the pending
   * one). 'unavailable' means no setup can complete right now.
   */
  stage: 'setup' | 'awaiting' | 'unavailable'
}

export default function WelcomeTrialModal({ cardSetup }: { cardSetup?: WelcomeCardSetup }) {
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seenRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const { markActivated } = useActivationCelebration()

  const open = !done

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
    // After the pending guard, so a double-click cannot inflate the count.
    // Never awaited: the CTA is the only way out of a non-dismissible modal and
    // must not wait on telemetry.
    trackTrialStartClicked().catch(() => {})
    try {
      const res = await startTrial()
      if ('error' in res) {
        setError('אירעה שגיאה, נסה שוב')
        trackTrialStartFailed(res.error === 'unauthorized' ? 'unauthorized' : 'unknown').catch(() => {})
        setPending(false)
        return
      }
      // Celebrate ONLY a genuine NEVER_STARTED → TRIAL_ACTIVE transition.
      // started:false (refresh / double-click / already-active) must not fire it.
      if (res.started) {
        markActivated()
        /**
         * Meta StartTrial. `trackStartTrial` has existed in
         * lib/facebook/pixelEvents.ts since the pixel was added and was called
         * from nowhere, so Meta only ever learned about `CompleteRegistration` —
         * the cheapest, noisiest event in the funnel — and optimised campaigns
         * toward registrations that may never activate.
         *
         * Gated on `res.started`, the same exactly-once condition as the
         * celebration, so a refresh or double-click cannot inflate it. Purely a
         * client-side pixel call: no trial logic, no entitlement, no billing.
         */
        trackStartTrial()
      }
      setDone(true)
    } catch {
      setError('אירעה שגיאה ברשת, נסה שוב')
      trackTrialStartFailed('network').catch(() => {})
      setPending(false)
    }
  }

  return (
    <ModalPop
      open={open}
      pos='middle'
      onClose={() => {}}
      hideClose
      labelledBy='welcome-trial-title'
      describedBy='welcome-trial-subtitle'
      /**
       * MOBILE SAFETY (presentation only — no trial logic is touched here).
       *
       * This dialog is the ONLY way into the product for a NEVER_STARTED agency
       * and it is non-dismissible, so a bad fit here costs the whole signup.
       *
       * Scope, measured rather than assumed: the pre-change dialog was NOT
       * broken — the CTA was reachable at every tested viewport down to
       * 360×480, because ModalPop already scrolls. What follows is hardening
       * and legibility, not a lockout fix. The one thing here that IS a real
       * defect fix is the safe-area inset, which headless Chromium cannot
       * reproduce (env() resolves to 0) and only appears on notched hardware.
       *   · p-5 instead of p-8 — at 360px, `p-8` spends 64px of a 360px viewport
       *     on padding and squeezes the benefit grid past its text's minimum.
       *   · safe-area bottom padding so the CTA never sits under the home
       *     indicator, where the OS swipe wins the gesture and the tap is eaten.
       *   · max-h/w in dvh/dvw so mobile browser chrome cannot clip the CTA.
       * The dialog still scrolls internally, so the CTA is reachable even on the
       * shortest supported screen.
       */
      className='mobile:max-h-[92dvh] mobile:w-[calc(100dvw-1.5rem)] mobile:p-5 mobile:pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]'
    >
      <div ref={dialogRef} className='flex flex-col gap-6 mobile:gap-4 w-full max-w-[640px]'>
        {/* Header: premium pill → headline → supporting → restrained trust copy */}
        <div className='flex flex-col items-center text-center gap-2.5'>
          <span className='inline-block rounded-full bg-dark text-white text-[10px] font-bold tracking-[0.12em] px-2.5 py-1 select-none'>
            SOCIALCRM PRO
          </span>
          {/*
            NOT "מוכן". This modal is the first thing 19 of 19 production
            agencies have seen, it is non-dismissible, and at this moment the
            workspace has zero לידים. "ה־SocialCRM Pro שלך מוכן" was true about
            the entitlement and false about the user's business — they went
            looking for the part that was ready and left. It names what is OPEN,
            then points at the next real step.
          */}
          <h2 id='welcome-trial-title' className='text-2xl font-bold leading-snug mobile:text-xl'>
            SocialCRM Pro פתוח לכם ל־7 ימים
          </h2>
          <p id='welcome-trial-subtitle' className='text-sm text-gray-600'>
            הצעד הבא: להכניס את הלידים שלכם למערכת
          </p>
          <p className='text-xs text-gray-400'>
            {cardSetup ? 'ללא עלות בתקופת הניסיון · נדרש כרטיס אשראי · לא יבוצע חיוב היום' : 'ללא עלות · ללא כרטיס אשראי'}
          </p>
        </div>

        {/* 2×2 benefit grid — distinct icon tiles.
            One column on phones. MEASURED at 360px (headless Chromium, real
            compiled CSS): a two-column cell is 142px wide, which leaves the
            title just 68px and wraps every one of the four to 2 lines —
            "כל כלי העבודה שלך" to 3. One column gives each title 118–160px and
            all four fit on a single line.
            Cost, stated honestly: the grid grows 238px → 256px at 360px and
            188px → 256px at 430px. The CTA remains reachable at every tested
            viewport (it always was — the dialog scrolls); this buys legibility,
            not access. On a 430×390 landscape phone it does push the CTA
            further below the fold — see the Phase 1 known limitations. */}
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1 mobile:gap-2'>
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className='flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 mobile:items-center mobile:gap-2.5 mobile:p-2.5'
            >
              <span className='flex size-9 items-center justify-center rounded-lg flex-none bg-primary-tint mobile:size-8'>
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

        {cardSetup ? (
          cardSetup.stage === 'awaiting' ? (
            <div role='status' className='space-y-2 text-center'>
              <p className='text-sm font-semibold text-gray-900'>הכרטיס נשמר. אנחנו מאמתים אותו מול חברת הסליקה.</p>
              <p className='text-sm text-gray-600'>תקופת הניסיון תתחיל מיד לאחר האימות, ולא בוצע חיוב.</p>
              <p className='text-xs text-gray-500'>האימות נמשך בדרך כלל מספר שניות. אפשר לרענן את העמוד.</p>
            </div>
          ) : cardSetup.stage === 'unavailable' ? (
            <div role='status' className='space-y-2 text-center'>
              <p className='text-sm font-semibold text-gray-900'>לא ניתן להוסיף אמצעי תשלום כרגע</p>
              <p className='text-sm text-gray-600'>מערכת התשלומים אינה זמינה זמנית, ולכן לא ניתן להתחיל את תקופת הניסיון. לא בוצע חיוב.</p>
              <p className='text-xs text-gray-500'>אפשר לנסות שוב מאוחר יותר, או לפנות אלינו ונטפל בזה.</p>
            </div>
          ) : cardSetup.canManageBilling ? (
            <CardTrialSetupForm purpose='trial_start' defaultFullName={cardSetup.defaultFullName} submitLabel='הוספת כרטיס והפעלת הניסיון' />
          ) : (
            <p className='text-sm text-gray-600 text-center'>רק מנהל החשבון יכול להפעיל את תקופת הניסיון.</p>
          )
        ) : (
          <>
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
          </>
        )}
      </div>
    </ModalPop>
  )
}
