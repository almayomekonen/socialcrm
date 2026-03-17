'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { formatDateTime } from '@/lib/dates'
import { useDrag } from '@/lib/hooksNEvents'
import { Input } from '@/lib/form'

let editNote, ctxMenu

export default function TaskNotes({ notes, userName }) {
  const [state, setState] = useState(false)
  const ref = useRef(null)
  const render = () => setState(!state)

  useEffect(() => {
    ctxMenu = document.getElementById('noteCtxMenu')
  }, [])

  function onAddNote() {
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
  }

  function onDelete() {
    if (!confirm(`האם למחוק הערה זו?`)) return
    notes.splice(notes.indexOf(editNote), 1) // delete the note from the array
    render()
    clearPopover()
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
    <div className='border-s border-e  px-2' style={{ gridArea: 'notes' }}>
      <div className=''>
        {notes?.map((note, i) => (
          <NoteItem key={i} note={note} {...useDrag(notes, i, render)} />
        ))}
      </div>

      <Input as='resizeTextarea' className=' w-full' placeholder='כתיבת הערה חדשה...' rows={1} name='note' ref={ref} />

      <div className='flex gap-2 justify-end -mt-1'>
        {editNote && <button onClick={onCancel}>ביטול</button>}
        <button onClick={onAddNote}>{editNote ? 'שמירה' : 'הוספה'}</button>
      </div>

      <NoteCtxMenu onDelete={onDelete} onEdit={onEdit} />
    </div>
  )
}

function NoteItem({ note, ...props }) {
  function onContextMenu(e) {
    e.preventDefault()
    editNote = note
    ctxMenu.style.left = `${e.clientX}px`
    ctxMenu.style.top = `${e.clientY}px`
    ctxMenu.showPopover()
  }

  return (
    <div onContextMenu={onContextMenu} className='rounded-md p-2 bg-[#d6d1f6] w-full mb-1' {...props}>
      <p className='whitespace-pre-wrap font-semibold'>{note.content}</p>
      <p className='text-sm flex justify-end'>
        {note.userName} - {formatDateTime(note.createdAt)}
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
        <button className='flex gap-2 hover:!bg-red-100' onClick={onDelete}>
          <Icon name='trash' className='size-3' />
          <p>מחיקה</p>
        </button>
      </div>
    </div>
  )
}

function clearPopover() {
  ctxMenu.hidePopover()
  editNote = null
}
