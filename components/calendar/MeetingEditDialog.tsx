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
import { editMeetingFeedback } from './editMeetingFeedback'
import { useT } from '@/lib/i18n/I18nProvider'

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
 *
 * Follows the interface language; results are read by code. Title and
 * attendee addresses are data.
 */
export default function MeetingEditDialog({ meetingId, onClose }: Props) {
  const router = useRouter()
  const t = useT()
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
        setLoadError(t('calendar.form.edit.notFound'))
      } else if (result.reason === 'not_owner') {
        setLoadError(t('calendar.form.edit.notOwner'))
      } else {
        setLoadError(t('calendar.form.edit.loadFailed'))
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
    if (!trimmedTitle) return setErrMsg(t('calendar.form.invalid.noTitle'))

    const startAt = new Date(startInput)
    const endAt = new Date(endInput)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return setErrMsg(t('calendar.form.invalid.badDate'))
    }
    if (endAt.getTime() <= startAt.getTime()) {
      return setErrMsg(t('calendar.form.invalid.endBeforeStart'))
    }
    // Same past-date rule as create / drag — explicit edits to a past start
    // are almost always fumbles. Resize/drag of an in-progress meeting still
    // works through their own handlers; this is for full form edits.
    if (startAt.getTime() < Date.now()) {
      return setErrMsg(t('calendar.form.invalid.pastEdit'))
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
      toast('success', t('calendar.form.edit.noChanges'))
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

      const fb = editMeetingFeedback(result)
      if (fb.saved) {
        toast(fb.tone, t(fb.message))
        startTransition(() => router.refresh())
        onClose()
        return
      }
      setErrMsg(t(fb.message))
    } catch (err) {
      console.warn('[MeetingEditDialog] submit error', err)
      setErrMsg(t('calendar.form.unexpected'))
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  return (
    <ModalPop open onClose={handleClose} label={t('calendar.form.editTitle')} pos='middle' className='w-[480px] max-w-[95vw]' translated>
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
          <h2 className='text-xl font-bold'>{t('calendar.form.error')}</h2>
          <p className='text-sm text-gray-600'>{loadError}</p>
          <div className='flex justify-end'>
            <Btn lbl={t('calendar.form.close')} variant='outline' onClick={onClose} />
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className='grid gap-4 pt-2'>
          <h2 className='text-xl font-bold'>{t('calendar.form.editTitle')}</h2>

          <Input
            name='title'
            lbl={t('calendar.form.titleLabel')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            autoFocus
          />

          <div className='grid grid-cols-2 gap-3'>
            <Input
              name='startAt'
              type='datetime-local'
              lbl={t('calendar.form.start')}
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              disabled={busy}
            />
            <Input
              name='endAt'
              type='datetime-local'
              lbl={t('calendar.form.end')}
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              disabled={busy}
            />
          </div>

          <AttendeeChipsInput
            value={attendeeEmails}
            onChange={setAttendeeEmails}
            lbl={t('calendar.form.attendees')}
            placeholder={t('calendar.form.attendeesPlaceholder')}
            disabled={busy}
          />

          <p className='text-xs text-gray-500 leading-relaxed -mt-2'>
            {t('calendar.form.editNotice')}
            <br />
            {t('calendar.form.timezone', { zone: browserTimezone })}
          </p>

          {errMsg && (
            <div className='rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
              {errMsg}
            </div>
          )}

          <div className='flex justify-end gap-2'>
            <Btn lbl={t('calendar.form.cancel')} variant='outline' type='button' onClick={handleClose} disabled={busy} />
            <Btn lbl={busy ? t('calendar.form.saving') : t('calendar.form.save')} type='submit' disabled={busy} />
          </div>
        </form>
      )}
    </ModalPop>
  )
}
