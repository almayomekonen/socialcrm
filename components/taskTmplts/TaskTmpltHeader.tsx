'use client'

import { Input } from '@/lib/form'
import Icon from '@/lib/Icon'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import SaveTaskTmplt from './SaveTaskTmplt'
import { deleteTaskTmplt } from '@/actions/tasks'

type TaskTmpltHeaderProps = {
  taskTmplt: any
}

export default function TaskTmpltHeader({ taskTmplt }: TaskTmpltHeaderProps) {
  const [state, setState] = useState(false)
  const render = () => setState(!state)

  function onContextMenu(e) {
    e.preventDefault()
    const taskTmpltTitleMenu = document.getElementById('taskTmpltTitleMenu')
    // show popover
    taskTmpltTitleMenu.style.left = `${e.clientX}px`
    taskTmpltTitleMenu.style.top = `${e.clientY}px`
    taskTmpltTitleMenu.showPopover()
  }

  return (
    <header>
      <div className='flex justify-between items-center w-full'>
        <h2 onContextMenu={onContextMenu} className='text-2xl font-bold '>
          {taskTmplt.title}
        </h2>
        <SaveTaskTmplt taskTmplt={taskTmplt} />
      </div>
      <HeaderPopMenu taskTmplt={taskTmplt} render={render} />
      <TaskTmpltTitleFormPop taskTmplt={taskTmplt} render={render} />
    </header>
  )
}

function HeaderPopMenu({ taskTmplt, render }) {
  function onDelete() {
    if (!confirm(`האם ברצנוך למחוק את תבנית המשימה "${taskTmplt.title}"?`)) return
    // delete task template
    deleteTaskTmplt(taskTmplt)
    render()
  }
  return (
    <>
      <div
        popover='auto'
        id='taskTmpltTitleMenu'
        className='bg-white/70 w-28 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
      >
        <div className='*:border-b text-sm *:hover:bg-gray-200 *:w-full *:p-2 *:last:border-b-0'>
          <button className='flex gap-2' popoverTarget='taskTmpltTitleForm' onClick={render}>
            <Icon name='pen' className='size-3' />
            <p>עריכה</p>
          </button>
          <button className='flex gap-2 hover:!bg-red-100' onClick={onDelete}>
            <Icon name='trash' className='size-3' />
            <p>מחק תבנית</p>
          </button>
        </div>
      </div>
    </>
  )
}

function TaskTmpltTitleFormPop({ taskTmplt, render }) {
  function onSave() {
    const title = (document.getElementById('taskTmpltTitle') as HTMLInputElement).value.trim()

    if (!title) return alert('יש להזין כותרת')

    taskTmplt.title = title
    // update task template
    render()
    document.getElementById('taskTmpltTitleForm').hidePopover()
    document.getElementById('taskTmpltTitleMenu').hidePopover()
  }

  return (
    <div popover='auto' id='taskTmpltTitleForm' className='pop p-4'>
      <Input lbl='כותרת' defaultValue={taskTmplt?.title} id='taskTmpltTitle' />
      <Btn lbl='שמירה' icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
    </div>
  )
}
