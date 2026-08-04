import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import { formatDateTime } from '@/lib/dates'
import SyncStatusBadge from './SyncStatusBadge'

/**
 * The post-create confirmation for a new meeting.
 *
 * Extracted from MeetingFormDialog, which crossed the 350-line hard limit when
 * the lead picker landed (architecture-rules §1/§8). The seam is real rather than
 * arithmetic: the dialog COLLECTS a meeting and this REPORTS one that already
 * exists — different state, different job, no shared logic.
 */

export type SuccessData = {
  title: string
  startAt: Date
  endAt: Date
  attendeeCount: number
  meetUrl: string | null
  syncStatus: 'synced' | 'failed' | 'reauth_required'
}

export default function SuccessView({ data, onClose }: { data: SuccessData; onClose: () => void }) {
  const synced = data.syncStatus === 'synced'
  const headline = synced ? 'הפגישה נוצרה' : 'הפגישה נשמרה'
  const subline = synced
    ? data.attendeeCount > 0
      ? 'הזמנות וקישור Google Meet נשלחו'
      : 'הפגישה סונכרנה ליומן Google'
    : data.syncStatus === 'reauth_required'
      ? 'נדרש חיבור מחדש ליומן לסנכרון ההזמנות'
      : 'הסנכרון ליומן Google נכשל — ניתן לנסות שוב מתוך הפגישה ביומן'

  return (
    <div className='grid gap-4 pt-2'>
      <div className='flex items-center gap-2.5'>
        <span
          className={`grid place-items-center size-9 rounded-full ${
            synced ? 'bg-green-100' : 'bg-amber-100'
          }`}
        >
          <Icon
            name={synced ? 'check' : 'triangle-exclamation'}
            type='reg'
            className={`size-5 ${synced ? 'bg-green-600' : 'bg-amber-700'}`}
          />
        </span>
        <div className='grid gap-0.5 min-w-0'>
          <h2 className='text-xl font-bold leading-tight'>{headline}</h2>
          <p className='text-xs text-gray-600'>{subline}</p>
        </div>
      </div>

      <div className='rounded-lg border border-gray-200 bg-gray-50/60 p-4 grid gap-3'>
        <SummaryRow lbl='כותרת'>{data.title}</SummaryRow>
        <SummaryRow lbl='זמן'>
          <span className='tabular-nums'>
            {formatDateTime(data.startAt)} – {formatDateTime(data.endAt)}
          </span>
        </SummaryRow>
        {data.attendeeCount > 0 && (
          <SummaryRow lbl='משתתפים'>
            {data.attendeeCount} {data.attendeeCount === 1 ? 'משתתף' : 'משתתפים'}
            {synced && ' · Google שלחה הזמנה'}
          </SummaryRow>
        )}
        <SummaryRow lbl='סטטוס סנכרון'>
          <SyncStatusBadge status={data.syncStatus} />
        </SummaryRow>
      </div>

      {data.meetUrl && (
        <a
          href={data.meetUrl}
          target='_blank'
          rel='noreferrer'
          className='inline-flex items-center justify-center h-10 px-4 rounded-md bg-solid text-white font-semibold hover:bg-solid/85'
        >
          פתח Google Meet
        </a>
      )}

      <div className='flex justify-end'>
        <Btn lbl='סגור' variant='outline' onClick={onClose} />
      </div>
    </div>
  )
}

function SummaryRow({ lbl, children }: { lbl: string; children: React.ReactNode }) {
  return (
    <div className='grid gap-1'>
      <div className='text-gray-500 text-xs uppercase tracking-wide'>{lbl}</div>
      <div className='text-sm text-gray-900'>{children}</div>
    </div>
  )
}
