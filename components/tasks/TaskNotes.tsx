'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { Input } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { updateFullTask, updateFullTaskTmplt } from '../../actions/tasks'
import { api } from '@/lib/funcs'
import { useAction } from '@/lib/useAction'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

const HEBREW = translatorFor('he')

/**
 * Notes on a task or a task template. `translated`: the caller's screen follows
 * the interface language (the lead task detail); the template editor in
 * settings is not translated yet and keeps Hebrew. Note text and authors are data.
 */
export default function TaskNotes({
  task,
  userName,
  type = 'task',
  translated = false,
}: {
  task: any
  userName: string
  type?: 'task' | 'template'
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const notes: any[] = task.notes ?? []
  const [state, setState] = useState(false)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const editNoteRef = useRef<any>(null)
  const ctxMenuRef = useRef<HTMLElement | null>(null)
  const render = () => setState((s) => !s)
  const { loading, error, setError, run } = useAction({ translated })

  useEffect(() => {
    ctxMenuRef.current = document.getElementById('noteCtxMenu')
  }, [])

  async function save() {
    if (type === 'template') {
      await api(updateFullTaskTmplt, task)
    } else {
      await api(updateFullTask, task)
    }
  }

  async function onAddNote() {
    const el = ref.current
    const content = el.value.trim()
    if (!content) { setError(t('leadTabs.tasks.notes.required')); return }

    await run(async () => {
      if (!editNoteRef.current) {
        notes.push({ userName, content, createdAt: new Date() })
      } else {
        editNoteRef.current.content = content
        editNoteRef.current.userName = userName
        editNoteRef.current.createdAt = new Date()
      }

      el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
      editNoteRef.current = null
      render()
      await save()
    })
  }

  async function deleteNote(note) {
    await run(async () => {
      notes.splice(notes.indexOf(note), 1)
      render()
      if (ctxMenuRef.current) { ctxMenuRef.current.hidePopover(); editNoteRef.current = null }
      await save()
    })
  }

  function onCancel() {
    editNoteRef.current = null
    ref.current.value = ''
    ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    render()
  }

  function onEdit() {
    ref.current.value = editNoteRef.current.content
    ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    ctxMenuRef.current?.hidePopover()
    render()
  }

  return (
    <div className='pt-6 border-t border-gray-100 mt-6 space-y-4'>
      <h3 className='font-semibold text-gray-800 text-base'>{t('leadTabs.tasks.notes.title')}</h3>

      {notes?.length > 0 && (
        <div className='flex flex-col gap-2'>
          {notes.map((note, i) => (
            <NoteItem key={i} t={t} note={note} onDelete={() => deleteNote(note)} onContextMenu={(e) => {
              e.preventDefault()
              editNoteRef.current = note
              if (ctxMenuRef.current) {
                ctxMenuRef.current.style.left = `${e.clientX}px`
                ctxMenuRef.current.style.top = `${e.clientY}px`
                ctxMenuRef.current.showPopover()
              }
            }} />
          ))}
        </div>
      )}

      <div className='space-y-2'>
        <Input
          as='resizeTextarea'
          className='w-full rounded-xl bg-gray-50 border-gray-200 p-4 min-h-20 focus:outline-2 focus:outline-offset-0 focus:outline-primary'
          placeholder={t('leadTabs.tasks.notes.placeholder')}
          rows={1}
          name='note'
          ref={ref}
        />

        {error && <p className='text-sm text-red-500'>{error}</p>}

        <div className='flex gap-2 justify-end items-center'>
          {editNoteRef.current && (
            <Btn
              lbl={t('common.dialog.cancel')}
              variant='ghost'
              size='small'
              onClick={onCancel}
            />
          )}
          <Btn
            lbl={loading ? '...' : editNoteRef.current ? t('common.save') : t('leadTabs.tasks.notes.add')}
            icon={editNoteRef.current ? 'floppy-disk' : 'plus'}
            size='small'
            onClick={onAddNote}
            disabled={loading}
          />
        </div>
      </div>

      <NoteCtxMenu t={t} onDelete={() => deleteNote(editNoteRef.current)} onEdit={onEdit} />
    </div>
  )
}

function NoteItem({ t, note, onDelete, onContextMenu }: { t: Translator; note: any; onDelete: () => void; onContextMenu: (e: React.MouseEvent) => void }) {
  return (
    <div
      onContextMenu={onContextMenu}
      className='group rounded-xl p-4 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm transition w-full'
    >
      <div className='flex justify-between items-start gap-2'>
        <p className='whitespace-pre-wrap flex-1 text-gray-800'>{note.content}</p>
        <button onClick={onDelete} aria-label={t('leadTabs.tasks.notes.deleteNote')} className='invisible group-hover:visible text-gray-400 hover:text-red-500 shrink-0 mt-0.5 transition-colors'>
          <Icon name='trash' className='size-3' />
        </button>
      </div>
      <p className='text-xs text-gray-400 mt-2 text-end'>
        {note.userName} · {formatLeadDateTime(t.locale, note.createdAt)}
      </p>
    </div>
  )
}

function NoteCtxMenu({ t, onEdit, onDelete }: { t: Translator; onEdit: () => void; onDelete: () => void }) {
  return (
    <div
      popover='auto'
      id='noteCtxMenu'
      className='bg-white/70 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
      style={{ position: 'fixed', margin: 0 }}
    >
      <div className='*:border-b text-sm *:hover:bg-gray-200 *:justify-center *:w-full w-21 *:py-2 *:last:border-b-0'>
        <button className='flex gap-2' onClick={onEdit}>
          <Icon name='pen' className='size-3' />
          <p>{t('leadTabs.tasks.detail.edit')}</p>
        </button>
        <button className='flex gap-2 hover:bg-red-100!' onClick={onDelete}>
          <Icon name='trash' className='size-3' />
          <p>{t('leadTabs.tasks.detail.delete')}</p>
        </button>
      </div>
    </div>
  )
}
