'use client'

import Icon from '@/lib/Icon'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const popId = 'taskCtxMenu'

export function onTaskCtxMenu(e) {
  e.preventDefault()
  const pop = document.getElementById(popId)
  // show popover
  pop.style.left = `${e.clientX}px`
  pop.style.top = `${e.clientY}px`
  pop.showPopover()
}

interface TaskCtxMenuProps {
  render: () => void
  onDelete: () => void
  editPopId: string
}

export function TaskCtxMenu({ render, onDelete, editPopId }: TaskCtxMenuProps) {
  return (
    <div
      popover='auto'
      id={popId}
      className='bg-white/70 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
    >
      <div className='*:border-b text-sm *:hover:bg-gray-200 *:justify-center *:w-full w-21 *:py-2 *:last:border-b-0'>
        <button className='flex gap-2' popoverTarget={editPopId} onClick={render}>
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

export function onTaskChange() {
  localStorage.hasChanges = 'true'
}

export function TaskPageEvents({ task: _task }) {
  const router = useRouter()

  useEffect(() => {
    if (localStorage.needsRefresh) {
      setTimeout(() => router.refresh(), 100)
      localStorage.removeItem('needsRefresh')
    }
  }, [])

  return null
}
