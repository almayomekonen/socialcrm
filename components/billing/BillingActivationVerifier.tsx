'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Clock, Loader2 } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import { getEntitlementStatus } from '@/actions/subscription'
import { clearAccessDenied } from '@/lib/entitlement/pollGate'

/**
 * /billing/success, as an actual verifier.
 *
 * IT USED TO BE A STOPWATCH. The page rendered "התשלום התקבל בהצלחה / ברוך הבא
 * למסלול Pro" unconditionally and bounced to settings after a 5s
 * `<meta http-equiv="refresh">`. It never asked whether the subscription had
 * actually been activated. Grow's webhook may land before the customer returns
 * or well after, so the old page announced success on a timer and, when the
 * webhook was slow, dropped the customer back into a product that still looked
 * expired — with "רענן אם אינך רואה את השדרוג" as the recovery plan.
 *
 * THREE HONEST STATES, never a fourth:
 *
 *   verifying  the payment is taken, activation is not yet confirmed
 *   active     the SERVER confirmed it; only now may we say "הופעל"
 *   timeout    still unconfirmed after the bounded window. Says so plainly
 *              rather than showing a success the server has not agreed to.
 *
 * `getEntitlementStatus().active` is deliberately not satisfied by a fail-open
 * read, so a database hiccup cannot produce a false "המנוי הופעל בהצלחה". See
 * the action for that rule.
 *
 * The client never talks to the payment provider. It asks our own server one
 * question and receives a boolean plus a lifecycle status — no transaction id,
 * no amount, no provider reference.
 */

/** Bounded and short. Grow's webhook normally lands in seconds. */
const POLL_INTERVAL_MS = 2_000
const MAX_WAIT_MS = 30_000

type Phase = 'verifying' | 'active' | 'timeout'

export default function BillingActivationVerifier() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('verifying')

  const onConfirmed = useCallback(() => {
    /**
     * The order matters. Clear the stale client latch FIRST so the pollers this
     * tab owns are live again, then ask the App Router to re-render from the
     * server: that re-runs the app layout, which re-seeds EntitlementProvider
     * from `getAgencyProductAccess`. Without the refresh the customer would hold
     * a confirmed-active subscription behind a client tree still seeded with
     * `hasAccess: false`, and every Pro surface would keep showing the expired
     * state until a manual reload.
     */
    clearAccessDenied()
    router.refresh()
    setPhase('active')
  }, [router])

  useEffect(() => {
    /**
     * THE LIFECYCLE IS PER EFFECT RUN, NOT PER COMPONENT.
     *
     * These were `useRef`s. Cleanup set `stopped.current = true` and no later
     * run ever set it back, so the SECOND run of this effect aborted on
     * `check()`'s first line and the page hung on "מאמתים" forever — no
     * confirmation, no refresh, and no timeout either, because the only path to
     * `setPhase('timeout')` runs inside `check()`. React StrictMode re-runs
     * every effect on mount in development, so that was every dev load; in
     * production it needed only `onConfirmed` to change identity.
     *
     * Locals fix it by construction: each run gets a fresh `cancelled` and its
     * own `startedAt`, and every closure reads the ones belonging to ITS run.
     * A cancelled run can therefore never confirm, refresh, set a phase, or
     * schedule another poll — while the live run polls normally. This is the
     * same shape EntitlementRecovery already uses, which is why that component
     * never had the bug.
     *
     * TERMINALITY MUST BE EXPLICIT, or the cure becomes its own disease.
     *
     * `onConfirmed` depends on `router`, so if `useRouter()` ever returns a new
     * object this effect re-runs on every render — including the render caused
     * by reaching `active` or `timeout`. A fresh run would then start a fresh
     * 30 second window and poll on past a terminal state, and an already
     * confirmed activation would call `router.refresh()` a second time. Reading
     * `phase` here makes both impossible: once this is no longer 'verifying',
     * there is nothing left to verify and the effect does nothing at all.
     */
    if (phase !== 'verifying') return

    const startedAt = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function check() {
      if (cancelled) return
      try {
        const res = await getEntitlementStatus()
        if (cancelled) return
        if (res.active) {
          cancelled = true // stop the moment it is confirmed
          onConfirmed()
          return
        }
      } catch {
        // A failed check is not a failed payment. Keep waiting quietly; the
        // bounded window still closes on its own.
      }
      if (cancelled) return
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        cancelled = true
        setPhase('timeout')
        return
      }
      timer = setTimeout(check, POLL_INTERVAL_MS)
    }

    check()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [onConfirmed, phase])

  return (
    <div className='w-full max-w-[420px] flex flex-col items-center gap-5 rounded-xl border border-gray-200 bg-white shadow-sm px-6 py-8'>
      {phase === 'active' ? (
        <CheckCircle className='size-10 text-green-500' strokeWidth={2} />
      ) : phase === 'timeout' ? (
        <Clock aria-hidden className='size-10 text-gray-400' strokeWidth={2} />
      ) : (
        <Loader2 aria-hidden className='size-10 animate-spin text-gray-400' strokeWidth={2} />
      )}

      <div className='flex flex-col gap-1 text-center'>
        <h1 className='text-lg font-semibold leading-snug'>
          {phase === 'active' ? 'המנוי הופעל בהצלחה' : 'התשלום התקבל'}
        </h1>
        <p className='text-sm font-medium text-gray-700'>
          {phase === 'active'
            ? 'SocialCRM Pro מוכן עבורך.'
            : phase === 'timeout'
              ? 'אנחנו עדיין מחכים לאישור הסופי של התשלום.'
              : 'אנחנו מאמתים את הפעלת המנוי...'}
        </p>
      </div>

      {phase === 'timeout' ? (
        <p className='text-sm text-gray-600 text-center leading-relaxed'>
          אפשר להיכנס למערכת ולנסות שוב בעוד כמה רגעים.
        </p>
      ) : null}

      {/*
        A live region so the state change is announced rather than only seen.
        The heading itself is not a live region, so screen-reader users would
        otherwise sit on "מאמתים" with no notice that it resolved.
      */}
      <p role='status' aria-live='polite' className='sr-only'>
        {phase === 'active'
          ? 'המנוי הופעל בהצלחה'
          : phase === 'timeout'
            ? 'ההפעלה עדיין ממתינה לאישור'
            : 'מאמתים את הפעלת המנוי'}
      </p>

      <Btn
        variant='solid'
        href='/dashboard'
        lbl={phase === 'active' ? 'המשך למערכת' : 'כניסה למערכת'}
        className='w-full'
      />
    </div>
  )
}
