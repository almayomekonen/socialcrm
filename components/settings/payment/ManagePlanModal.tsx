'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import ModalPop from '@/lib/modals/ModalPop'
import { cancelRenewal, resumeRenewal } from '@/actions/subscription'
import type { SubscriptionClientView } from './ManagePlanLauncher'
import { ConfirmCancelBody, ManageBody } from './ManagePlanBodies'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
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
            ? t('settings.payment.manage.cancelInactive')
            : t('settings.payment.manage.error'),
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
            ? t('settings.payment.manage.resumeInactive')
            : t('settings.payment.manage.error'),
        )
        return
      }
      setOptimisticCancel(false)
      router.refresh()
    })
  }

  return (
    <ModalPop open={open} onClose={close} label={t('settings.payment.manage.label')} pos='middle' className='w-[min(90vw,28rem)]' translated>
      <div className='space-y-5' dir={t.locale === 'he' ? 'rtl' : undefined}>
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
