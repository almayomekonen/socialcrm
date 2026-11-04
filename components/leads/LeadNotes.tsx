'use client'

import { useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { Input } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { ENTITLEMENT_ERROR, useAction } from '@/lib/useAction'
import { useT } from '@/lib/i18n/I18nProvider'
import { formatDateTime } from '@/lib/i18n/format'
import { BUSINESS_TZ } from '@/lib/today/constants'
import type { Translator } from '@/lib/i18n/translate'
import { addLeadNote, deleteLeadNote, type LeadNoteErrorCode } from '@/actions/leadNotes'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { LEAD_NOTE_MAX_LENGTH, type LeadNote } from '@/lib/leads/leadNotes'

function errorMessage(t: Translator, code: LeadNoteErrorCode): string {
  switch (code) {
    case 'empty':
      return t('leadDetail.activity.errors.empty')
    case 'tooLong':
      return t('leadDetail.activity.errors.tooLong')
    case 'notFound':
      return t('leadDetail.activity.errors.notFound')
  }
}

/**
 * Notes on a lead: what was said, what was agreed. The note card and the text
 * box follow TaskNotes. Unlike it, the draft is kept until the server has saved
 * it, so a failed save never loses what the rep typed.
 *
 * The time is formatted in BUSINESS_TZ for every language. This component is
 * server-rendered, and the server and the browser sit in different timezones, so
 * a time formatted in the device's timezone would break hydration.
 */
export default function LeadNotes({
  leadId,
  notes: initialNotes,
  surface,
}: {
  leadId: number
  notes: LeadNote[]
  surface: 'desktop' | 'mobile'
}) {
  const t = useT()
  const [notes, setNotes] = useState(initialNotes)
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<LeadNote | null>(null)
  const boxRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const { loading, error, setError, run } = useAction({ translated: true })
  const shownError = error === ENTITLEMENT_ERROR ? t('common.actionFailed') : error

  async function add() {
    const submitted = draft
    await run(async () => {
      const res = await addLeadNote({ leadId, content: submitted })
      if ('err' in res) {
        setError(errorMessage(t, res.err))
        return
      }
      setNotes((current) => [res.note, ...current])
      // Anything typed while this one was saving is the next note: keep it.
      setDraft((current) => {
        if (current !== submitted) return current
        if (boxRef.current) boxRef.current.style.height = ''
        return ''
      })
      recordLeadActionEvent('lead_action_taken', { surface, action: 'note', leadId }).catch(() => {})
    })
  }

  async function confirmDelete() {
    const note = pendingDelete
    if (!note) return
    setPendingDelete(null)
    await run(async () => {
      const res = await deleteLeadNote({ id: note.id })
      if ('err' in res) {
        setError(errorMessage(t, res.err))
        return
      }
      setNotes((current) => current.filter((n) => n.id !== note.id))
    })
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Input
          as='resizeTextarea'
          className='w-full rounded-xl bg-gray-50 border-gray-200 p-4 min-h-20 focus:outline-2 focus:outline-offset-0 focus:outline-primary'
          placeholder={t('leadDetail.activity.placeholder')}
          aria-label={t('leadDetail.activity.placeholder')}
          rows={1}
          name='leadNote'
          required={false}
          maxLength={LEAD_NOTE_MAX_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          ref={boxRef}
        />
        {shownError && <p className='text-sm text-red-500'>{shownError}</p>}
        <div className='flex justify-end'>
          <Btn
            lbl={loading ? t('leadDetail.activity.saving') : t('leadDetail.activity.add')}
            icon='plus'
            size='small'
            onClick={add}
            disabled={loading || !draft.trim()}
          />
        </div>
      </div>

      {notes.length === 0 ? (
        <p className='text-sm text-gray-500 text-center py-6'>{t('leadDetail.activity.empty')}</p>
      ) : (
        <div className='flex flex-col gap-2'>
          {notes.map((note) => (
            <div key={note.id} className='rounded-xl p-4 bg-white border border-gray-200 w-full'>
              <div className='flex justify-between items-start gap-2'>
                <p dir='auto' className='whitespace-pre-wrap wrap-anywhere flex-1 text-gray-800'>
                  {note.content}
                </p>
                <button
                  type='button'
                  onClick={() => setPendingDelete(note)}
                  disabled={loading}
                  aria-label={t('leadDetail.activity.delete')}
                  className='shrink-0 -m-2 size-9 inline-flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50'
                >
                  <Icon name='trash' className='size-3' />
                </button>
              </div>
              <p className='text-xs text-gray-400 mt-2 text-end tabular-nums'>
                {note.userName ? `${note.userName} · ` : ''}
                {formatDateTime(t.locale, note.createdAt, BUSINESS_TZ, 'short')}
              </p>
            </div>
          ))}
        </div>
      )}

      <ConfirmPop
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        msg={t('leadDetail.activity.confirmDelete')}
        confirmLbl={t('leadDetail.activity.delete')}
        destructive
        translated
      />
    </div>
  )
}
