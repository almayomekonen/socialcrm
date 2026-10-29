import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import SyncStatusBadge from './SyncStatusBadge'
import { useT } from '@/lib/i18n/I18nProvider'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

/**
 * The post-create confirmation for a new meeting.
 *
 * Extracted from MeetingFormDialog, which crossed the 350-line hard limit when
 * the lead picker landed (architecture-rules §1/§8). The seam is real rather than
 * arithmetic: the dialog COLLECTS a meeting and this REPORTS one that already
 * exists — different state, different job, no shared logic.
 *
 * Follows the interface language; the title is data. Times: Hebrew keeps the
 * legacy `formatDateTime`, other languages the business time zone.
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
  const t = useT()
  const synced = data.syncStatus === 'synced'
  const headline = synced ? t('calendar.success.created') : t('calendar.success.saved')
  const subline = synced
    ? data.attendeeCount > 0
      ? t('calendar.success.invitesSent')
      : t('calendar.success.synced')
    : data.syncStatus === 'reauth_required'
      ? t('calendar.success.reauth')
      : t('calendar.success.failed')
  const when = (at: Date) => formatLeadDateTime(t.locale, at)
  const count = { count: String(data.attendeeCount) }

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
        <SummaryRow lbl={t('calendar.success.title')}>{data.title}</SummaryRow>
        <SummaryRow lbl={t('calendar.success.time')}>
          <span className='tabular-nums'>
            {when(data.startAt)} – {when(data.endAt)}
          </span>
        </SummaryRow>
        {data.attendeeCount > 0 && (
          <SummaryRow lbl={t('calendar.success.attendees')}>
            {synced ? t('calendar.success.attendeeCountInvited', count) : t('calendar.success.attendeeCount', count)}
          </SummaryRow>
        )}
        <SummaryRow lbl={t('calendar.success.syncStatus')}>
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
          {t('calendar.success.openMeet')}
        </a>
      )}

      <div className='flex justify-end'>
        <Btn lbl={t('calendar.success.close')} variant='outline' onClick={onClose} />
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
