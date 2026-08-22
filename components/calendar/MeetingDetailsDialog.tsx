'use client'

import { useState } from 'react'
import Link from 'next/link'
import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { Btn } from '@/lib/btns/Btn'
import { formatDateTime } from '@/lib/dates'
import type { MeetingSummaryDTO } from '@/actions/calendar'
import SyncStatusBadge from './SyncStatusBadge'
import MeetingOutcomeBadge from './MeetingOutcomeBadge'
import LeadStatusNudge from './LeadStatusNudge'
import FollowUpControl from '@/components/leads/FollowUpControl'
import { useMeetingOutcomeActions } from './hooks/useMeetingOutcomeActions'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { proToast } from '@/lib/toast'

type Props = {
  meeting: MeetingSummaryDTO
  onClose: () => void
  onCancel: () => Promise<void>
  onRetry: () => Promise<void>
  onEdit: () => void
  retrying: boolean
  cancelling: boolean
}

export default function MeetingDetailsDialog({
  meeting,
  onClose,
  onCancel,
  onRetry,
  onEdit,
  retrying,
  cancelling,
}: Props) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  /**
   * Entitlement from the shared context. Outcome, cancel, edit and sync-retry
   * all call requireProductAccess-guarded actions, so on a lapsed subscription
   * every one of them ended in "אירעה שגיאה. נסה שוב." — a retry for something
   * only payment can clear. The meeting's details stay fully readable; the
   * mutating controls are withheld and named once.
   */
  const expired = useAccessDenied()

  const outcome = useMeetingOutcomeActions({ onSettled: onClose })

  /**
   * Derived from the meeting alone. An expired subscription does not make a
   * scheduled meeting look unscheduled or a failed sync look fine: the record
   * is shown as it is, and the controls answer with the billing prompt when
   * they are reached.
   */
  const canRetry = meeting.syncStatus === 'failed'
  const isScheduled = meeting.status === 'scheduled'

  const promptEdit = () =>
    proToast({
      title: 'עריכת פגישות זמינה עם Pro',
      body: 'חידוש המנוי יחזיר את האפשרות לערוך פגישות.',
      source: 'calendar_edit',
    })
  const promptOutcome = () =>
    proToast({
      title: 'עדכון תוצאת פגישה זמין עם Pro',
      body: 'חידוש המנוי יחזיר את האפשרות לעדכן תוצאות.',
      source: 'calendar_outcome',
    })
  const busy = retrying || cancelling || outcome.busy !== null

  return (
    <>
      <ModalPop
        open
        onClose={busy ? () => {} : outcome.pendingNudge ? outcome.dismissNudge : onClose}
        pos='middle'
        labelledBy='meeting-details-title'
        className='w-[460px] max-w-[95vw]'
      >
        <div className='grid gap-4 pt-2'>
          <div className='flex items-start gap-2 flex-wrap'>
            <h2 id='meeting-details-title' className='text-xl font-bold flex-1 min-w-0 wrap-break-word'>{meeting.title}</h2>
            <div className='flex items-center gap-1.5 flex-wrap'>
              <MeetingOutcomeBadge
                status={meeting.status}
                completedAt={meeting.completedAt}
                noShowAt={meeting.noShowAt}
              />
              <SyncStatusBadge status={meeting.syncStatus} />
            </div>
          </div>

          <div className='grid gap-1 text-sm'>
            <div className='text-gray-500 text-xs uppercase tracking-wide'>זמן</div>
            <div>
              {formatDateTime(meeting.startAt)} – {formatDateTime(meeting.endAt)}
            </div>
          </div>

          {meeting.leadId && (
            <div className='grid gap-1 text-sm'>
              <div className='text-gray-500 text-xs uppercase tracking-wide'>ליד</div>
              <div className='flex items-center justify-between gap-2'>
                <Link href={`/clients/${meeting.leadId}/summary`} className='text-blue-700 hover:underline w-fit'>
                  צפה בליד ←
                </Link>
                <FollowUpControl leadId={meeting.leadId} />
              </div>
            </div>
          )}

          {meeting.syncError && meeting.syncStatus !== 'synced' && (
            <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 wrap-break-word'>
              <span className='font-medium'>פרטי כשל: </span>
              {meeting.syncError}
            </div>
          )}

          {meeting.meetUrl && (
            <a
              href={meeting.meetUrl}
              target='_blank'
              rel='noreferrer'
              className='inline-flex items-center justify-center h-10 px-4 rounded-md bg-solid text-white font-semibold hover:bg-solid/85'
            >
              פתח Google Meet
            </a>
          )}

          {isScheduled && !outcome.pendingNudge && (
            <div className='flex gap-2 flex-wrap pt-1'>
              <Btn
                lbl={outcome.busy === 'completed' ? 'מסמן…' : 'סמן כהושלמה'}
                variant='solid'
                onClick={() => (expired ? promptOutcome() : outcome.markCompleted(meeting.id))}
                disabled={busy}
              />
              <Btn
                lbl={outcome.busy === 'no_show' ? 'מסמן…' : 'סמן כלא הגיע'}
                variant='outline'
                onClick={() => (expired ? promptOutcome() : outcome.markNoShow(meeting.id))}
                disabled={busy}
              />
            </div>
          )}

          {outcome.pendingNudge && (
            <LeadStatusNudge
              suggested={outcome.pendingNudge.suggested}
              onApply={outcome.applyNudge}
              onDismiss={outcome.dismissNudge}
              busy={outcome.busy === 'nudge'}
            />
          )}

          <div className='flex items-center justify-between gap-2 pt-3 mt-1 border-t border-gray-100 flex-wrap'>
            {/* When a nudge is pending the close button routes through
                dismissNudge so the dismissal is explicit (and so any future
                telemetry can distinguish "rep declined the suggestion" from
                "rep closed without seeing it"). Behaviorally identical today
                — dismissNudge calls onSettled which is onClose. */}
            <Btn
              lbl='סגור'
              variant='outline'
              onClick={outcome.pendingNudge ? outcome.dismissNudge : onClose}
              disabled={busy}
            />
            <div className='flex gap-2 flex-wrap'>
              {canRetry && (
                <Btn
                  lbl={retrying ? 'מסנכרן…' : 'נסה לסנכרן שוב'}
                  variant='outline'
                  onClick={onRetry}
                  disabled={busy}
                />
              )}
              {/* Edit/Cancel hide while a nudge is pending — the rep just
                  marked an outcome, so the meeting is no longer in a
                  scheduled state (the next page refresh will flip
                  isScheduled to false anyway). Keeping them visible would
                  also offer a hidden third "exit" from the nudge decision. */}
              {isScheduled && !outcome.pendingNudge && (
                <>
                  <Btn lbl='ערוך פגישה' variant='outline' onClick={expired ? promptEdit : onEdit} disabled={busy} />
                  <Btn
                    lbl={cancelling ? 'מבטל…' : 'ביטול הפגישה'}
                    variant='destructive'
                    onClick={() => setConfirmCancel(true)}
                    disabled={busy}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </ModalPop>

      <ConfirmPop
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          await onCancel()
          setConfirmCancel(false)
        }}
        msg={`לבטל את הפגישה "${meeting.title}"?\nהמשתתפים יקבלו הודעת ביטול.`}
        confirmLbl='ביטול הפגישה'
        destructive
      />
    </>
  )
}
