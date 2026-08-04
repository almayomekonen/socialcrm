'use client'

import { useEffect, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import SuccessView, { type SuccessData } from './MeetingSuccessView'
import LeadPicker from '@/components/billing/lead-picker/LeadPicker'
import type { RecentLead } from '@/components/billing/lead-picker/types'
import { getLeadById, searchLeads } from '@/actions/clients'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { FormField, Input } from '@/lib/form'
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

  /**
   * The lead this meeting is for.
   *
   * Seeded from the `leadId` prop when the dialog is opened from a lead's own
   * context, and otherwise chosen here. Without it the meeting has no lead, and
   * appointment automations cannot run — Law 2 requires exactly one resolved
   * Lead, and the Meetings domain will not guess one from an attendee address.
   */
  const [pickedLeadId, setPickedLeadId] = useState<number | null>(leadId ?? null)
  const [pickedLeadName, setPickedLeadName] = useState('')
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([])

  // The picker's empty-query list. `searchLeads('')` is the existing
  // agency-scoped reader the billing picker already uses; typing 2+ characters
  // switches it to a live search on its own.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const rows = (await searchLeads('')) as RecentLead[]
        if (!cancelled) setRecentLeads(rows)
      } catch {
        // A failed prefill leaves the picker searchable — never blocks the form.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // The name for the trigger label. The picker hands back an id; this is the
  // existing agency-scoped reader for the rest.
  useEffect(() => {
    if (pickedLeadId == null) return setPickedLeadName('')
    let cancelled = false
    void (async () => {
      const lead = await getLeadById(pickedLeadId)
      if (cancelled || !lead) return
      const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
      setPickedLeadName(name || `ליד #${pickedLeadId}`)
    })()
    return () => {
      cancelled = true
    }
  }, [pickedLeadId])

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
        leadId: pickedLeadId,
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
    <ModalPop open={open} onClose={handleClose} label='פגישה חדשה' pos='middle' className='w-[480px] max-w-[95vw]'>
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

          <FormField lbl='ליד' info='הפגישה תקושר לליד הזה'>
            <LeadPicker
              currentLeadId={pickedLeadId ?? 0}
              currentLeadName={pickedLeadName}
              recentLeads={recentLeads}
              onPick={(id) => setPickedLeadId(id)}
              onCreateNew={() => router.push('/clients?new=1')}
            />
          </FormField>

          {pickedLeadId == null && (
            /* Said BEFORE the meeting is created, not discovered afterwards by a
               reminder that never arrived. A meeting with no lead is a valid
               meeting — it just cannot carry automations. */
            <p className='text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 leading-relaxed'>
              לא נבחר ליד — אוטומציות פגישה (כמו תזכורת לפני הפגישה) לא יפעלו עבור הפגישה הזו.
            </p>
          )}

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
