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
import { createMeeting } from '@/actions/calendar'
import { useT } from '@/lib/i18n/I18nProvider'
import { ERROR_KEYS, defaultEndDate, defaultStartDate, toLocalInput } from './meetingFormDefaults'
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

export default function MeetingFormDialog({
  open,
  onClose,
  leadId,
  defaultStart,
  defaultEnd,
}: Props) {
  const router = useRouter()
  const t = useT()
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
      setPickedLeadName(name || t('calendar.form.leadFallback', { id: String(pickedLeadId) }))
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

    if (!title) return setErrMsg(t('calendar.form.invalid.noTitle'))

    const startAt = new Date(startInput)
    const endAt = new Date(endInput)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      return setErrMsg(t('calendar.form.invalid.badDate'))
    }
    if (endAt.getTime() <= startAt.getTime()) {
      return setErrMsg(t('calendar.form.invalid.endBeforeStart'))
    }
    // Block past-start creation. Today's calendar query shows past-today
    // meetings (see app/(app)/calendar/page.tsx), but knowingly creating a
    // meeting in the past is almost always a fumbled time entry. Mirrors
    // the drag-to-past guard in CalendarView.tsx.
    if (startAt.getTime() < Date.now()) {
      return setErrMsg(t('calendar.form.invalid.pastCreate'))
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

      setErrMsg(t(ERROR_KEYS[result.reason] ?? 'calendar.form.createError.generic'))
    } catch (err) {
      console.warn('[MeetingFormDialog] submit error', err)
      setErrMsg(t('calendar.form.unexpected'))
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
    <ModalPop open={open} onClose={handleClose} label={t('calendar.form.newTitle')} pos='middle' className='w-[480px] max-w-[95vw]' translated>
      {success ? (
        <SuccessView data={success} onClose={handleClose} />
      ) : (
        <form onSubmit={onSubmit} className='grid gap-4 pt-2'>
          <h2 className='text-xl font-bold'>{t('calendar.form.newTitle')}</h2>

          <Input
            name='title'
            lbl={t('calendar.form.titleLabel')}
            placeholder={t('calendar.form.titlePlaceholder')}
            autoFocus
            disabled={busy}
          />

          <div className='grid grid-cols-2 gap-3'>
            <Input
              name='startAt'
              type='datetime-local'
              lbl={t('calendar.form.start')}
              defaultValue={toLocalInput(start)}
              disabled={busy}
            />
            <Input
              name='endAt'
              type='datetime-local'
              lbl={t('calendar.form.end')}
              defaultValue={toLocalInput(end)}
              disabled={busy}
            />
          </div>

          <FormField lbl={t('calendar.form.lead')} info={t('calendar.form.leadInfo')}>
            {/* The picker's panel is shared with billing and stays Hebrew; its
                trigger shows our placeholder (Hebrew: the picker's own default). */}
            <LeadPicker
              currentLeadId={pickedLeadId ?? 0}
              currentLeadName={pickedLeadName || t('calendar.form.leadPlaceholder')}
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
              {t('calendar.form.noLead')}
            </p>
          )}

          <AttendeeChipsInput
            value={attendees}
            onChange={setAttendees}
            lbl={t('calendar.form.attendees')}
            placeholder={t('calendar.form.attendeesPlaceholder')}
            disabled={busy}
          />

          <p className='text-xs text-gray-500 leading-relaxed -mt-2'>
            {t('calendar.form.googleInvites')}
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
            <Btn lbl={busy ? t('calendar.form.creating') : t('calendar.form.create')} type='submit' disabled={busy} />
          </div>
        </form>
      )}
    </ModalPop>
  )
}
