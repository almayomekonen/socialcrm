'use client'

import { useState } from 'react'
import Link from 'next/link'
import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { Btn } from '@/lib/btns/Btn'
import { formatDateTime } from '@/lib/dates'
import type { MeetingSummaryDTO } from '@/actions/calendar'
import SyncStatusBadge from './SyncStatusBadge'

type Props = {
  meeting: MeetingSummaryDTO
  onClose: () => void
  onCancel: () => Promise<void>
  onRetry: () => Promise<void>
  retrying: boolean
  cancelling: boolean
}

export default function MeetingDetailsDialog({
  meeting,
  onClose,
  onCancel,
  onRetry,
  retrying,
  cancelling,
}: Props) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const canRetry = meeting.syncStatus === 'failed'
  const busy = retrying || cancelling

  return (
    <>
      <ModalPop
        open
        onClose={busy ? () => {} : onClose}
        pos='middle'
        className='w-[460px] max-w-[95vw]'
      >
        <div className='grid gap-4 pt-2'>
          <div className='flex items-start gap-3 flex-wrap'>
            <h2 className='text-xl font-bold flex-1 min-w-0 break-words'>{meeting.title}</h2>
            <SyncStatusBadge status={meeting.syncStatus} />
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
            <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 break-words'>
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
              <Btn
                lbl={cancelling ? 'מבטל…' : 'ביטול הפגישה'}
                variant='destructive'
                onClick={() => setConfirmCancel(true)}
                disabled={busy}
              />
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
