'use client'

import { Btn } from '@/lib/btns/Btn'
import { formatDate } from '@/lib/dates'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'

/**
 * The manage-plan modal's two views (split from ManagePlanModal): the plan
 * summary with its actions, and the cancel confirmation. State and actions
 * live in the modal; these render them.
 */

export function ManageBody({
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

export function ConfirmCancelBody({
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
