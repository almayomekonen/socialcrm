'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { Input } from '@/lib/form'
import { toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/dates'
import { createMeeting } from '@/actions/calendar'
import AttendeeChipsInput from './AttendeeChipsInput'
import SyncStatusBadge from './SyncStatusBadge'

type Props = {
  open: boolean
  onClose: () => void
  leadId?: number | null
  // Prefill from a calendar slot click. Both omitted → form uses sensible
  // defaults (next hour, +1h). Only start provided → end = start + 1h.
  defaultStart?: Date
  defaultEnd?: Date
}

type SuccessData = {
  title: string
  startAt: Date
  endAt: Date
  attendeeCount: number
  meetUrl: string | null
  syncStatus: 'synced' | 'failed' | 'reauth_required'
}

const browserTimezone =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultStartDate(): Date {
  const t = new Date()
  t.setMinutes(0, 0, 0)
  t.setHours(t.getHours() + 1)
  return t
}

function defaultEndDate(start: Date): Date {
  const t = new Date(start)
  t.setHours(t.getHours() + 1)
  return t
}

const ERROR_LABELS: Record<string, string> = {
  invalid_input: 'הקלט אינו תקין. בדוק את השדות.',
  lead_not_found: 'הליד לא נמצא.',
  not_found: 'הפגישה לא נמצאה.',
  not_owner: 'אינך מורשה לפעולה זו.',
  already_synced: 'הפגישה כבר סונכרנה.',
}

export default function MeetingFormDialog({
  open,
  onClose,
  leadId,
  defaultStart,
  defaultEnd,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [attendees, setAttendees] = useState<string[]>([])
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [, startTransition] = useTransition()

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setErrMsg(null)

    const data = new FormData(e.currentTarget)
    const title = String(data.get('title') ?? '').trim()
    const startInput = String(data.get('startAt') ?? '')
    const endInput = String(data.get('endAt') ?? '')

    if (!title) return setErrMsg('יש להזין כותרת לפגישה')

    const startAt = new Date(startInput)
    const endAt = new Date(endInput)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return setErrMsg('יש להזין תאריך ושעה תקינים')
    }
    if (endAt.getTime() <= startAt.getTime()) {
      return setErrMsg('שעת הסיום חייבת להיות אחרי שעת ההתחלה')
    }
    // Block past-start creation. Today's calendar query shows past-today
    // meetings (see app/(app)/calendar/page.tsx), but knowingly creating a
    // meeting in the past is almost always a fumbled time entry. Mirrors
    // the drag-to-past guard in CalendarView.tsx.
    if (startAt.getTime() < Date.now()) {
      return setErrMsg('לא ניתן ליצור פגישה בתאריך שעבר')
    }

    setBusy(true)
    try {
      const result = await createMeeting({
        leadId: leadId ?? null,
        title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timezone: browserTimezone,
        attendees: attendees.map((email) => ({ email })),
      })

      if (result.ok === true) {
        setSuccess({
          title,
          startAt,
          endAt,
          attendeeCount: attendees.length,
          meetUrl: result.meetUrl,
          syncStatus: result.syncStatus,
        })
        // Refresh the calendar grid behind the success view — the new event
        // is already in the DB; we just need to re-fetch.
        startTransition(() => router.refresh())
        return
      }

      setErrMsg(ERROR_LABELS[result.reason] ?? 'יצירת הפגישה נכשלה')
    } catch (err) {
      console.warn('[MeetingFormDialog] submit error', err)
      setErrMsg('אירעה שגיאה. נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  const start = defaultStart ?? defaultStartDate()
  const end = defaultEnd ?? defaultEndDate(start)

  return (
    <ModalPop open={open} onClose={handleClose} pos='middle' className='w-[480px] max-w-[95vw]'>
      {success ? (
        <SuccessView data={success} onClose={handleClose} />
      ) : (
        <form onSubmit={onSubmit} className='grid gap-4 pt-2'>
          <h2 className='text-xl font-bold'>פגישה חדשה</h2>

          <Input
            name='title'
            lbl='כותרת'
            placeholder='לדוגמה: שיחת תיאום'
            autoFocus
            disabled={busy}
          />

          <div className='grid grid-cols-2 gap-3'>
            <Input
              name='startAt'
              type='datetime-local'
              lbl='התחלה'
              defaultValue={toLocalInput(start)}
              disabled={busy}
            />
            <Input
              name='endAt'
              type='datetime-local'
              lbl='סיום'
              defaultValue={toLocalInput(end)}
              disabled={busy}
            />
          </div>

          <AttendeeChipsInput
            value={attendees}
            onChange={setAttendees}
            lbl='משתתפים'
            placeholder='הוסף אימייל ולחץ Enter'
            disabled={busy}
          />

          <p className='text-xs text-gray-500 leading-relaxed -mt-2'>
            Google תשלח הזמנות וקישור Google Meet אוטומטית לכל המשתתפים.
            <br />
            אזור זמן: {browserTimezone}
          </p>

          {errMsg && (
            <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
              {errMsg}
            </div>
          )}

          <div className='flex justify-end gap-2'>
            <Btn lbl='ביטול' variant='outline' type='button' onClick={handleClose} disabled={busy} />
            <Btn lbl={busy ? 'יוצר…' : 'צור פגישה'} type='submit' disabled={busy} />
          </div>
        </form>
      )}
    </ModalPop>
  )
}

function SuccessView({ data, onClose }: { data: SuccessData; onClose: () => void }) {
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
