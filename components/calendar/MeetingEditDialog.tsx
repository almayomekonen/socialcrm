'use client'

import { useEffect, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { toast } from '@/lib/toast'
import {
  getMeetingForEdit,
  updateMeeting,
  type MeetingEditDTO,
} from '@/actions/calendar'
import AttendeeChipsInput from './AttendeeChipsInput'

type Props = {
  meetingId: number
  onClose: () => void
}

const browserTimezone =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Edit an existing meeting. Loads the meeting + attendees on mount, prefills
 * the form, and on submit sends ONLY the fields that actually changed to
 * updateMeeting. The dirty-field check is critical for `attendees`: Google's
 * events.patch replaces the entire attendee list when present in the body
 * AND resets every attendee's responseStatus to 'needsAction'. Sending the
 * unchanged list on every save would silently undo all the accept/decline
 * RSVPs that came in since the meeting was created.
 */
export default function MeetingEditDialog({ meetingId, onClose }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<MeetingEditDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state. Initialized to empty strings; filled when load completes.
  const [title, setTitle] = useState('')
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [attendeeEmails, setAttendeeEmails] = useState<string[]>([])

  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMeetingForEdit(meetingId).then((result) => {
      if (cancelled) return
      if (result.ok === true) {
        setInitial(result.meeting)
        setTitle(result.meeting.title)
        setStartInput(toLocalInput(result.meeting.startAt))
        setEndInput(toLocalInput(result.meeting.endAt))
        setAttendeeEmails(result.meeting.attendees.map((a) => a.email))
      } else if (result.reason === 'not_found') {
        setLoadError('הפגישה לא נמצאה')
      } else if (result.reason === 'not_owner') {
        setLoadError('אינך מורשה לערוך פגישה זו')
      } else {
        setLoadError('טעינת הפגישה נכשלה')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !initial) return
    setErrMsg(null)

    const trimmedTitle = title.trim()
    if (!trimmedTitle) return setErrMsg('יש להזין כותרת לפגישה')

    const startAt = new Date(startInput)
    const endAt = new Date(endInput)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return setErrMsg('יש להזין תאריך ושעה תקינים')
    }
    if (endAt.getTime() <= startAt.getTime()) {
      return setErrMsg('שעת הסיום חייבת להיות אחרי שעת ההתחלה')
    }
    // Same past-date rule as create / drag — explicit edits to a past start
    // are almost always fumbles. Resize/drag of an in-progress meeting still
    // works through their own handlers; this is for full form edits.
    if (startAt.getTime() < Date.now()) {
      return setErrMsg('לא ניתן להעביר פגישה לתאריך שעבר')
    }

    // Dirty detection — only include changed keys in the patch. This avoids
    // the attendee-RSVP-reset trap (see component-level JSDoc) and keeps
    // the Google patch body minimal.
    const titleChanged = trimmedTitle !== initial.title
    const startChanged = startAt.toISOString() !== new Date(initial.startAt).toISOString()
    const endChanged = endAt.toISOString() !== new Date(initial.endAt).toISOString()

    const originalEmails = new Set(initial.attendees.map((a) => a.email.toLowerCase()))
    const submittedEmails = new Set(attendeeEmails.map((e) => e.trim().toLowerCase()))
    const attendeesChanged =
      originalEmails.size !== submittedEmails.size ||
      [...originalEmails].some((e) => !submittedEmails.has(e))

    if (!titleChanged && !startChanged && !endChanged && !attendeesChanged) {
      // Nothing to save — close as a no-op rather than fire an empty patch.
      toast('success', 'לא בוצעו שינויים')
      onClose()
      return
    }

    setBusy(true)
    try {
      const result = await updateMeeting({
        meetingId,
        title: titleChanged ? trimmedTitle : undefined,
        startAt: startChanged || endChanged ? startAt.toISOString() : undefined,
        endAt: startChanged || endChanged ? endAt.toISOString() : undefined,
        // Timezone goes alongside any start/end change so updateMeeting can
        // forward it to Google. For a pure attendee-only edit it's omitted.
        timezone: startChanged || endChanged ? browserTimezone : undefined,
        attendees: attendeesChanged
          ? [...submittedEmails].map((email) => ({ email }))
          : undefined,
        // Explicit edit — notify everyone (matches the create flow's
        // implicit 'all'). Drag/resize use 'externalOnly' but a form save
        // is a deliberate action where attendee notification is the point.
        sendUpdates: 'all',
      })

      if (result.ok === true) {
        if (result.syncStatus === 'synced') {
          toast('success', 'הפגישה עודכנה וסונכרנה ליומן Google')
        } else if (result.syncStatus === 'not_synced') {
          toast('success', 'הפגישה עודכנה ב-CRM (לא מסונכרנת ליומן Google)')
        } else if (result.syncStatus === 'reauth_required') {
          toast('error', 'הפגישה עודכנה ב-CRM. נדרש חיבור מחדש ליומן Google.')
        } else {
          toast('error', 'הפגישה עודכנה ב-CRM. סנכרון ליומן Google נכשל.')
        }
        startTransition(() => router.refresh())
        onClose()
        return
      }

      if (result.reason === 'conflict') {
        toast('error', 'הפגישה עודכנה ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).')
        startTransition(() => router.refresh())
        onClose()
        return
      }
      if (result.reason === 'not_owner') {
        setErrMsg('אינך מורשה לערוך פגישה זו')
        return
      }
      if (result.reason === 'not_found') {
        setErrMsg('הפגישה לא נמצאה')
        return
      }
      // invalid_input with various `details`.
      if (result.details === 'duration_too_short') {
        setErrMsg('משך הפגישה חייב להיות לפחות 5 דקות')
        return
      }
      if (result.details === 'end_before_start') {
        setErrMsg('שעת הסיום חייבת להיות אחרי שעת ההתחלה')
        return
      }
      if (result.details === 'cancelled') {
        setErrMsg('לא ניתן לערוך פגישה מבוטלת')
        return
      }
      setErrMsg('עדכון הפגישה נכשל')
    } catch (err) {
      console.warn('[MeetingEditDialog] submit error', err)
      setErrMsg('אירעה שגיאה. נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  return (
    <ModalPop open onClose={handleClose} label='עריכת פגישה' pos='middle' className='w-[480px] max-w-[95vw]'>
      {loading ? (
        <div className='grid gap-3 pt-2'>
          <div className='h-6 bg-gray-100 rounded animate-pulse' />
          <div className='h-9 bg-gray-100 rounded animate-pulse' />
          <div className='grid grid-cols-2 gap-3'>
            <div className='h-9 bg-gray-100 rounded animate-pulse' />
            <div className='h-9 bg-gray-100 rounded animate-pulse' />
          </div>
          <div className='h-9 bg-gray-100 rounded animate-pulse' />
        </div>
      ) : loadError ? (
        <div className='grid gap-4 pt-2'>
          <h2 className='text-xl font-bold'>שגיאה</h2>
          <p className='text-sm text-gray-600'>{loadError}</p>
          <div className='flex justify-end'>
            <Btn lbl='סגור' variant='outline' onClick={onClose} />
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className='grid gap-4 pt-2'>
          <h2 className='text-xl font-bold'>עריכת פגישה</h2>

          <Input
            name='title'
            lbl='כותרת'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            autoFocus
          />

          <div className='grid grid-cols-2 gap-3'>
            <Input
              name='startAt'
              type='datetime-local'
              lbl='התחלה'
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              disabled={busy}
            />
            <Input
              name='endAt'
              type='datetime-local'
              lbl='סיום'
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              disabled={busy}
            />
          </div>

          <AttendeeChipsInput
            value={attendeeEmails}
            onChange={setAttendeeEmails}
            lbl='משתתפים'
            placeholder='הוסף אימייל ולחץ Enter'
            disabled={busy}
          />

          <p className='text-xs text-gray-500 leading-relaxed -mt-2'>
            שינויים בכותרת או בזמן יישלחו לכל המשתתפים. שינויים ברשימת המשתתפים יוסיפו או יסירו אנשים מהפגישה.
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
            <Btn lbl={busy ? 'שומר…' : 'שמור שינויים'} type='submit' disabled={busy} />
          </div>
        </form>
      )}
    </ModalPop>
  )
}
