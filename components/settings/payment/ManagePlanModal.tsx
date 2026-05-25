'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import { formatDate } from '@/lib/dates'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import type { SubscriptionClientView } from './ManagePlanLauncher'

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
    <ModalPop open={open} onClose={close} pos='middle' className='w-[min(90vw,28rem)]'>
      <div className='space-y-5' dir='rtl'>
        {stage === 'manage' && (
          <ManageBody
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

        {stage === 'confirm-cancel' && (
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
  manageable,
  expiresAtIso,
  status,
  pending,
  error,
  onAskCancel,
  onResume,
  onClose,
}: {
  manageable: boolean
  expiresAtIso: string | null
  status: 'active' | 'cancelling' | 'inactive'
  pending: boolean
  error: string | null
  onAskCancel: () => void
  onResume: () => void
  onClose: () => void
}) {
  const statusLabel = status === 'cancelling' ? 'חידוש הופסק' : 'פעיל'

  return (
    <>
      <h2 className='text-xl font-bold'>מסלול Pro</h2>

      <div className='space-y-1 text-sm text-gray-700'>
        {expiresAtIso && <p>גישה פעילה עד: {formatDate(expiresAtIso)}</p>}
        <p>סטטוס: {statusLabel}</p>
      </div>

      {!manageable && <p className='text-sm text-gray-500'>לא ניתן לנהל את המסלול הנוכחי</p>}

      {error && <p className='text-sm text-red-700'>{error}</p>}

      <div className='flex gap-3 justify-end pt-2'>
        {manageable && status === 'active' && (
          <Btn
            variant='destructive'
            lbl={pending ? 'טוען...' : 'בטל חידוש'}
            disabled={pending}
            onClick={onAskCancel}
          />
        )}
        {manageable && status === 'cancelling' && (
          <Btn
            variant='solid'
            lbl={pending ? 'טוען...' : 'חידוש מסלול'}
            disabled={pending}
            onClick={onResume}
          />
        )}
        {!manageable && <Btn variant='destructive' lbl='בטל חידוש' disabled onClick={() => {}} />}

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
      <h2 className='text-xl font-bold'>האם להפסיק את חידוש מסלול ה-Pro?</h2>

      {expiresAtIso && (
        <p className='text-sm text-gray-700'>הגישה שלך תישאר פעילה עד: {formatDate(expiresAtIso)}</p>
      )}

      {error && <p className='text-sm text-red-700'>{error}</p>}

      <div className='flex gap-3 justify-end pt-2'>
        <Btn
          variant='destructive'
          lbl={pending ? 'טוען...' : 'אישור'}
          disabled={pending}
          onClick={onConfirm}
        />
        <Btn variant='outline' lbl='חזור' disabled={pending} onClick={onBack} />
      </div>
    </>
  )
}
