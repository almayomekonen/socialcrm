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
import { useMeetingOutcomeActions } from './hooks/useMeetingOutcomeActions'

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
  // Outcome actions are owned by the dialog (not the parent) so CalendarView
  // doesn't grow further. onSettled closes the dialog right after a
  // successful mark — matches the "under-2-second" workflow target: click
  // event → click outcome → done.
  const outcome = useMeetingOutcomeActions({ onSettled: onClose })

  const canRetry = meeting.syncStatus === 'failed'
  const isScheduled = meeting.status === 'scheduled'
  const busy = retrying || cancelling || outcome.busy !== null

  return (
    <>
      <ModalPop
        open
        onClose={busy ? () => {} : onClose}
        pos='middle'
        className='w-[460px] max-w-[95vw]'
      >
        <div className='grid gap-4 pt-2'>
          <div className='flex items-start gap-2 flex-wrap'>
            <h2 className='text-xl font-bold flex-1 min-w-0 wrap-break-word'>{meeting.title}</h2>
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
              <Link
                href={`/clients/${meeting.leadId}`}
                className='text-blue-700 hover:underline w-fit'
              >
                צפה בליד ←
              </Link>
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

          {/* Outcome action row — only shown when meeting is still scheduled.
              Terminal states (completed / no_show / cancelled) replace these
              buttons with the OutcomeBadge above. Undo lands in Stage 3+. */}
          {isScheduled && (
            <div className='flex gap-2 flex-wrap pt-1'>
              <Btn
                lbl={outcome.busy === 'completed' ? 'מסמן…' : 'סמן כהושלמה'}
                variant='solid'
                onClick={() => outcome.markCompleted(meeting.id)}
                disabled={busy}
              />
              <Btn
                lbl={outcome.busy === 'no_show' ? 'מסמן…' : 'סמן כלא הגיע'}
                variant='outline'
                onClick={() => outcome.markNoShow(meeting.id)}
                disabled={busy}
              />
            </div>
          )}

          {/* Edit + Cancel are scheduled-only. Terminal-state meetings
              (completed / no_show) become read-only — the outcome record
              is locked until undo lands. Retry stays available because
              it's a sync-correctness action, not a state mutation. */}
          <div className='flex items-center justify-between gap-2 pt-3 mt-1 border-t border-gray-100 flex-wrap'>
            <Btn lbl='סגור' variant='outline' onClick={onClose} disabled={busy} />
            <div className='flex gap-2 flex-wrap'>
              {canRetry && (
                <Btn
                  lbl={retrying ? 'מסנכרן…' : 'נסה לסנכרן שוב'}
                  variant='outline'
                  onClick={onRetry}
                  disabled={busy}
                />
              )}
              {isScheduled && (
                <>
                  <Btn lbl='ערוך פגישה' variant='outline' onClick={onEdit} disabled={busy} />
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
