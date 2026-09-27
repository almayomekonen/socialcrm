'use client'

import { useEffect, useRef, useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { startTrial, trackTrialStartClicked, trackTrialStartFailed, trackWelcomeModalSeen } from '@/actions/trial'
import CardTrialSetupForm from './CardTrialSetupForm'
import { trackStartTrial } from '@/lib/facebook/pixelEvents'
import { useActivationCelebration } from './ActivationCelebrationContext'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'


/**
 * ONE headline and ONE sentence per state, in a single table.
 *
 * The defect this replaces: a fixed header — "SocialCRM Pro פתוח לכם ל־7 ימים"
 * over "ללא עלות · ללא כרטיס אשראי" — rendered above whichever body applied,
 * so an account with no billing path read that Pro was open to it, that no card
 * was needed, and then that the trial had not opened yet. Three claims, two of
 * them false, on the one screen a new customer cannot dismiss.
 *
 * Keeping the copy beside the state it belongs to is what stops a state from
 * inheriting another's promise. Nothing here says a trial is running: the trial
 * begins when Grow's callback is verified, never when this modal renders.
 */
type View = 'setup' | 'awaiting' | 'unavailable' | 'later' | 'start'

const COPY: Record<View, { title: string; sub: string }> = {
  setup: { title: 'מתחילים עם SocialCRM Pro', sub: '7 ימים ללא עלות. נדרש אימות כרטיס, והיום לא יבוצע חיוב.' },
  awaiting: { title: 'הכרטיס נשמר, ואנחנו מאמתים אותו', sub: 'תקופת הניסיון תתחיל מיד לאחר האימות, ולא בוצע חיוב.' },
  unavailable: { title: 'לא ניתן להתחיל כרגע', sub: 'מערכת התשלומים אינה זמינה זמנית, ולכן תקופת הניסיון עדיין לא נפתחה. לא בוצע חיוב.' },
  later: { title: 'תקופת הניסיון תיפתח כאן בקרוב', sub: 'אנחנו משלימים את חיבור התשלומים. החשבון שלכם שמור, לא בוצע חיוב, ואין צורך בשום פעולה.' },
  /* Click-to-start, no card. Unreachable while hasBillingPath() and the card
     variant share one flag, but it is a real no-card path, so it is the one
     state where "ללא כרטיס אשראי" is true and it keeps saying so. */
  start: { title: 'מתחילים עם SocialCRM Pro', sub: 'הצעד הבא: להכניס את הלידים שלכם למערכת.' },
}

/** A closing line for the states that have no action to offer. */
const TAIL: Record<'awaiting' | 'unavailable' | 'later', string> = {
  awaiting: 'האימות נמשך בדרך כלל מספר שניות. אפשר לרענן את העמוד.',
  unavailable: 'אפשר לנסות שוב מאוחר יותר, או לפנות אלינו ונטפל בזה.',
  later: 'נעדכן אתכם ברגע שאפשר יהיה להתחיל.',
}

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
  /** From an abandoned attempt, so it is not retyped. Consent is never carried over. */
  defaultPhone?: string
  canManageBilling: boolean
  /**
   * 'setup' offers the form. 'awaiting' means a card is already saved and being
   * verified — the account is not activated and must not be told otherwise, and
   * must not be handed the form again (a second setup supersedes the pending
   * one). 'unavailable' means no setup can complete right now.
   */
  stage: 'setup' | 'awaiting' | 'unavailable'
}

export default function WelcomeTrialModal({
  cardSetup,
  trialOpensLater = false,
}: {
  cardSetup?: WelcomeCardSetup
  /** No billing path yet: show the honest wait instead of a start button. */
  trialOpensLater?: boolean
}) {
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

  useDialogFocusTrap(open, dialogRef)

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

  const view: View = cardSetup
    ? cardSetup.stage === 'awaiting'
      ? 'awaiting'
      : cardSetup.stage === 'unavailable'
        ? 'unavailable'
        : 'setup'
    : trialOpensLater
      ? 'later'
      : 'start'

  /** Nothing to do here but read — no form, no button. */
  const informational = view === 'awaiting' || view === 'unavailable' || view === 'later'

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
       *   · p-5 instead of p-8 — at 360px, `p-8` spends 64px of a 360px viewport
       *     on padding.
       *   · safe-area bottom padding so the CTA never sits under the home
       *     indicator, where the OS swipe wins the gesture and the tap is eaten.
       *   · max-h/w in dvh/dvw so mobile browser chrome cannot clip the CTA.
       * The dialog still scrolls internally, so the CTA is reachable even on the
       * shortest supported screen.
       */
      className='mobile:max-h-[92dvh] mobile:w-[calc(100dvw-1.5rem)] mobile:p-5 mobile:pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]'
    >
      {/*
        Narrower than the 640px it replaced: with the feature grid gone the only
        two-column content left is the name/phone row, and a shorter measure is
        what makes Hebrew body copy readable rather than scanned.
      */}
      <div ref={dialogRef} className='flex flex-col gap-5 w-full max-w-[560px] mobile:gap-4'>
        <div className='flex flex-col items-start gap-2 text-start'>
          <span className='inline-block rounded-full bg-dark text-white text-[10px] font-bold tracking-[0.12em] px-2.5 py-1 select-none'>
            SOCIALCRM PRO
          </span>
          <h2 id='welcome-trial-title' className='text-[22px] font-bold leading-snug text-gray-900 mobile:text-xl'>
            {COPY[view].title}
          </h2>
          <p id='welcome-trial-subtitle' className='text-sm leading-relaxed text-gray-600'>
            {COPY[view].sub}
          </p>
        </div>

        {error && (
          <p className='text-sm text-red-500' role='alert'>
            {error}
          </p>
        )}

        {view === 'setup' && cardSetup ? (
          cardSetup.canManageBilling ? (
            /* The disclosure, both consents and the terms link live in the form
               and are recorded against CARD_TRIAL_TERMS_VERSION. Nothing here
               summarises or shortens them. */
            <CardTrialSetupForm
              purpose='trial_start'
              defaultFullName={cardSetup.defaultFullName}
              defaultPhone={cardSetup.defaultPhone}
              submitLabel='הוספת כרטיס והפעלת הניסיון'
            />
          ) : (
            <p className='text-sm text-gray-600'>רק מנהל החשבון יכול להפעיל את תקופת הניסיון.</p>
          )
        ) : informational ? (
          <p role='status' className='text-sm text-gray-500'>
            {TAIL[view as 'awaiting' | 'unavailable' | 'later']}
          </p>
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
            <p className='text-xs text-gray-400 -mt-2'>7 ימים ללא עלות · ללא כרטיס אשראי · אפשר לבטל בכל עת</p>
          </>
        )}
      </div>
    </ModalPop>
  )
}
