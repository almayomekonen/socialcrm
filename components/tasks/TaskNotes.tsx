'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { formatDateTime } from '@/lib/dates'
import { Input } from '@/lib/form'
import { updateFullTask, updateFullTaskTmplt } from '../../actions/tasks'
import { api } from '@/lib/funcs'

let editNote, ctxMenu

export default function TaskNotes({ task, userName, type = 'task' }: { task: any; userName: string; type?: 'task' | 'template' }) {
  const notes = task.notes
  const [state, setState] = useState(false)
  const ref = useRef(null)
  const render = () => setState(!state)

  useEffect(() => {
    ctxMenu = document.getElementById('noteCtxMenu')
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
    if (!content) return alert('יש להזין תוכן להערה')

    if (!editNote) notes.push({ userName, content, createdAt: new Date() })
    else {
      editNote.content = content
      editNote.userName = userName
      editNote.createdAt = new Date()
    }

    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    editNote = null
    render()
    await save()
  }

  async function deleteNote(note) {
    if (!confirm(`האם למחוק הערה זו?`)) return
    notes.splice(notes.indexOf(note), 1)
    render()
    if (ctxMenu) { ctxMenu.hidePopover(); editNote = null }
    await save()
  }

  function onCancel() {
    editNote = null
    ref.current.value = ''
    ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    render()
  }

  function onEdit() {
    ref.current.value = editNote.content
    ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    ctxMenu.hidePopover()
    render()
  }

  return (
    <div className='pt-6 border-t mt-6'>
      <h3 className='font-semibold text-gray-700 mb-3'>הערות</h3>

      <div className='flex flex-col gap-2 mb-4'>
        {notes?.map((note, i) => (
          <NoteItem key={i} note={note} onDelete={() => deleteNote(note)} />
        ))}
      </div>

      <Input as='resizeTextarea' className='w-full' placeholder='כתיבת הערה חדשה...' rows={1} name='note' ref={ref} />

      <div className='flex gap-2 justify-end mt-2'>
        {editNote && <button onClick={onCancel} className='text-sm text-gray-500 hover:text-gray-700'>ביטול</button>}
        <button onClick={onAddNote} className='text-sm font-semibold text-solid hover:opacity-80'>
          {editNote ? 'שמירה' : 'הוספה'}
        </button>
      </div>

      <NoteCtxMenu onDelete={() => deleteNote(editNote)} onEdit={onEdit} />
    </div>
  )
}

function NoteItem({ note, onDelete }: { note: any; onDelete: () => void }) {
  function onContextMenu(e) {
    e.preventDefault()
    editNote = note
    ctxMenu.style.left = `${e.clientX}px`
    ctxMenu.style.top = `${e.clientY}px`
    ctxMenu.showPopover()
  }

  return (
    <div onContextMenu={onContextMenu} className='group rounded-md p-3 bg-gray-50 border border-gray-100 w-full'>
      <div className='flex justify-between items-start gap-2'>
        <p className='whitespace-pre-wrap flex-1'>{note.content}</p>
        <button onClick={onDelete} className='invisible group-hover:visible text-gray-400 hover:text-red-500 shrink-0 mt-0.5 transition-colors'>
          <Icon name='trash' className='size-3' />
        </button>
      </div>
      <p className='text-xs text-gray-400 mt-1 text-end'>
        {note.userName} · {formatDateTime(note.createdAt)}
      </p>
    </div>
  )
}

function NoteCtxMenu({ onEdit, onDelete }) {
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
          <p>עריכה</p>
        </button>
        <button className='flex gap-2 hover:bg-red-100!' onClick={onDelete}>
          <Icon name='trash' className='size-3' />
          <p>מחיקה</p>
        </button>
      </div>
    </div>
  )
}
