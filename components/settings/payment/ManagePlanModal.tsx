'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import ModalPop from '@/lib/modals/ModalPop'
import { formatDate } from '@/lib/dates'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import type { SubscriptionClientView } from './ManagePlanLauncher'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'

type Stage = 'manage' | 'confirm-cancel'

/**
 * Manage Plan modal.
 *
 * State strategy:
 *  - `cancelAtPeriodEnd` is mirrored in local state (`optimisticCancel`) so
 *    the modal swaps to its post-action view immediately after a successful
 *    server action — without waiting for the server tree to re-render.
 *    `useEffect` re-syncs from the prop when the parent re-renders (e.g.,
 *    after `router.refresh()` lands or the user re-opens the modal).
 *  - `router.refresh()` fires ONLY after a successful action — never on
 *    error, never preemptively. This is what the constraint requires.
 *  - `useTransition` + `disabled={pending}` block double-fires; the label
 *    swaps to "טוען..." so the user sees the loading state.
 *  - Errors stay inline inside the modal. No toasts, no detached UI.
 */
export default function ManagePlanModal({
  open,
  onClose,
  subscription,
}: {
  open: boolean
  onClose: () => void
  subscription: SubscriptionClientView
}) {
  const router = useRouter()
  /**
   * Entitlement from the shared context — the same `getAgencyProductAccess`
   * answer the rest of the app uses. Read ONCE here and passed down, so the
   * modal's body and its actions can never disagree about the same fact.
   */
  const expired = useAccessDenied()
  const [stage, setStage] = useState<Stage>('manage')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [optimisticCancel, setOptimisticCancel] = useState(subscription.cancelAtPeriodEnd)

  // Re-sync optimistic state when the underlying prop changes (e.g., after
  // router.refresh lands or the user re-opens the modal).
  useEffect(() => {
    setOptimisticCancel(subscription.cancelAtPeriodEnd)
  }, [subscription.cancelAtPeriodEnd])

  const { manageable, expiresAtIso, plan } = subscription
  const status: 'active' | 'cancelling' | 'inactive' =
    plan !== 'pro' ? 'inactive' : optimisticCancel ? 'cancelling' : 'active'

  const close = () => {
    if (pending) return
    setStage('manage')
    setError(null)
    onClose()
  }

  const doCancel = () => {
    // A lapsed subscription has nothing left to cancel. The UI never offers it,
    // but the guard makes that a property of the component rather than of the
    // markup that happens to render above it.
    if (expired) return
    setError(null)
    startTransition(async () => {
      const result = await cancelRenewal()
      if ('error' in result) {
        setError(
          result.error === 'no_subscription'
            ? 'לא ניתן לבטל מסלול שאינו פעיל'
            : 'אירעה שגיאה, נסו שוב',
        )
        return
      }
      setOptimisticCancel(true)
      setStage('manage')
      router.refresh()
    })
  }

  const doResume = () => {
    if (expired) return
    setError(null)
    startTransition(async () => {
      const result = await resumeRenewal()
      if ('error' in result) {
        setError(
          result.error === 'no_subscription'
            ? 'לא ניתן לחדש מסלול שאינו פעיל'
            : 'אירעה שגיאה, נסו שוב',
        )
        return
      }
      setOptimisticCancel(false)
      router.refresh()
    })
  }

  return (
    <ModalPop open={open} onClose={close} label='ניהול המנוי' pos='middle' className='w-[min(90vw,28rem)]'>
      <div className='space-y-5' dir='rtl'>
        {(stage === 'manage' || expired) && (
          <ManageBody
            expired={expired}
            manageable={manageable}
            expiresAtIso={expiresAtIso}
            status={status}
            pending={pending}
            error={error}
            onAskCancel={() => setStage('confirm-cancel')}
            onResume={doResume}
            onClose={close}
          />
        )}

        {/*
          The cancel-confirmation step is unreachable for an expired
          subscription: there is no renewal left to stop, and offering to
          cancel something that already ended is the dead end the audit found.
        */}
        {stage === 'confirm-cancel' && !expired && (
          <ConfirmCancelBody
            expiresAtIso={expiresAtIso}
            pending={pending}
            error={error}
            onConfirm={doCancel}
            onBack={() => {
              if (pending) return
              setError(null)
              setStage('manage')
            }}
          />
        )}
      </div>
    </ModalPop>
  )
}

function ManageBody({
  expired,
  manageable,
  expiresAtIso,
  status,
  pending,
  error,
  onAskCancel,
  onResume,
  onClose,
}: {
  expired: boolean
  manageable: boolean
  expiresAtIso: string | null
  status: 'active' | 'cancelling' | 'inactive'
  pending: boolean
  error: string | null
  onAskCancel: () => void
  onResume: () => void
  onClose: () => void
}) {
  // 'cancelling' = the customer's cancellation request is RECORDED HERE
  // (cancelAtPeriodEnd). Pro access still runs to expiresAt, so the date stays
  // an access-end date; otherwise it renews and expiresAt is the next charge
  // date. What this state does NOT mean is that the standing order at the
  // payment provider has been stopped — see the label below.
  const cancelling = status === 'cancelling'
  /**
   * ONE RULE FOR BOTH LABELS: "החיוב הבא" and "פעיל" are shown ONLY when the
   * subscription is genuinely renewing. Everything else is an end-of-access
   * state and is labelled as one.
   *
   * `status` is the SUBSCRIPTION-ROW status, which stays 'active' after a paid
   * period lapses — so this modal told an expired customer "סטטוס: פעיל" and
   * "החיוב הבא: 20/8/2026", a date already in the past presented as the next
   * charge. A live production audit observed both, on desktop and on mobile.
   *
   * `status === 'inactive'` (plan is not Pro) had the same defect for the same
   * reason: it fell through the ternary chain to 'פעיל'.
   *
   * Entitlement comes from the shared context (`getAgencyProductAccess` via
   * `useAccessDenied`, read by the parent) — never a plan-name check.
   *
   * THE CANCELLING LABEL STATES ONLY WHAT WE KNOW. It used to read "המנוי
   * בוטל", asserted from `cancelAtPeriodEnd` alone — a flag this app sets on
   * its own row. Nothing in the system contacts the payment provider to stop
   * the standing order, so "בוטל" claimed an outcome we had neither performed
   * nor observed. The one fact we can stand behind is that the request was
   * recorded, so that is what it now says. When provider cancellation is
   * genuinely confirmed, THAT is what earns the word "בוטל" — not this flag.
   */
  const renewing = !expired && status === 'active'
  const statusLabel = expired
    ? 'המנוי הסתיים'
    : cancelling
      ? 'בקשת הביטול נקלטה'
      : status === 'inactive'
        ? 'לא פעיל'
        : 'פעיל'
  /**
   * There is no NEXT charge for a lapsed subscription, so the date is relabelled
   * as the end of access rather than suppressed — the customer still needs to
   * know when it ended, they just must not be told it is upcoming.
   */
  const dateLabel = renewing ? 'החיוב הבא' : expired ? 'המנוי הסתיים ב' : 'גישה ל־Pro עד'

  return (
    <>
      <h2 className='text-xl font-bold'>מסלול Pro</h2>

      <div className='space-y-1 text-sm text-gray-700'>
        {expiresAtIso && (
          <p>
            {dateLabel}: {formatDate(expiresAtIso)}
          </p>
        )}
        <p>סטטוס: {statusLabel}</p>
      </div>

      {!manageable && <p className='text-sm text-gray-500'>לא ניתן לנהל את המסלול הנוכחי</p>}

      {error && <p className='text-sm text-red-700'>{error}</p>}

      <div className='flex gap-3 justify-end pt-2'>
        {/*
          EXPIRED: renewal is the primary action, cancel is not offered.
          The audit found this modal offering only "בטל מנוי" and "סגור" to a
          customer whose subscription had already lapsed — a dead end for the
          person you most want back, and an offer to cancel something that has
          already ended. Entitlement comes from the shared context, never from
          a plan-name check in client code. The CTA is a link to the EXISTING
          upgrade route, so rendering it writes nothing.
        */}
        {expired ? (
          <a
            href={upgradeHref('manage_plan_modal')}
            className='press inline-flex min-h-11 items-center justify-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            חידוש מנוי
          </a>
        ) : null}
        {!expired && manageable && status === 'active' && (
          <Btn
            variant='destructive'
            lbl={pending ? 'טוען...' : 'בטל מנוי'}
            disabled={pending}
            onClick={onAskCancel}
          />
        )}
        {!expired && manageable && status === 'cancelling' && (
          <Btn
            variant='solid'
            lbl={pending ? 'טוען...' : 'חידוש מסלול'}
            disabled={pending}
            onClick={onResume}
          />
        )}
        {!expired && !manageable && <Btn variant='destructive' lbl='בטל מנוי' disabled onClick={() => {}} />}

        <Btn variant='outline' lbl='סגור' disabled={pending} onClick={onClose} />
      </div>
    </>
  )
}

function ConfirmCancelBody({
  expiresAtIso,
  pending,
  error,
  onConfirm,
  onBack,
}: {
  expiresAtIso: string | null
  pending: boolean
  error: string | null
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <>
      <h2 className='text-xl font-bold'>לבטל את מסלול ה־Pro?</h2>

      {/*
        The access half of this sentence is verified — entitlement is driven by
        `expiresAt` and cancelling touches neither it nor the plan — so it is
        kept verbatim. The billing half ("המנוי לא יתחדש") was not: nothing here
        stops the standing order, so promising no future charge was a claim the
        system had no way to keep. It is replaced by what actually happens.
      */}
      {expiresAtIso && (
        <p className='text-sm text-gray-700'>
          בקשת הביטול תירשם, והגישה שלך ל־Pro תישאר פעילה עד {formatDate(expiresAtIso)}.
        </p>
      )}

      {error && <p className='text-sm text-red-700'>{error}</p>}

      <div className='flex gap-3 justify-end pt-2'>
        <Btn
          variant='destructive'
          lbl={pending ? 'טוען...' : 'בטל מנוי'}
          disabled={pending}
          onClick={onConfirm}
        />
        <Btn variant='outline' lbl='חזור' disabled={pending} onClick={onBack} />
      </div>
    </>
  )
}
