'use client'

import { Input } from '@/lib/form'
import { deleteTask, updateFullTask } from '../../actions/tasks'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { statusOptions } from './SelectTasksStatus'
import { api } from '@/lib/funcs'
import { onTaskChange, onTaskCtxMenu, TaskCtxMenu } from './utils'
import { SelectSearch } from '@/lib/form/SelectSearch'

type TaskHeaderProps = {
  task: any
  users: any[]
}

export default function TaskHeader({ task, users }: TaskHeaderProps) {
  const [state, setState] = useState(false)
  const render = () => setState(!state)

  async function saveTask() {
    api(updateFullTask, task)
  }

  function onDelete() {
    if (!confirm(`האם ברצנוך למחוק את המעקב "${task.title}"?`)) return
    deleteTask(task)
    render()
    onTaskChange()
  }

  return (
    <div className='flex gap-4' style={{ gridArea: 'header' }}>
      <h2 onContextMenu={onTaskCtxMenu} className='text-2xl font-bold'>
        {task.title}
      </h2>

      <SelectSearch
        name='userId'
        placeholder='חיפוש גורם מטפל..'
        options={users}
        selected={task.userId}
        onSelectOpt={(user) => (task.userId = user.id)}
      />
      <SelectSearch
        name='status'
        placeholder='חיפוש סטטוס..'
        options={statusOptions}
        selected={task.status}
        onSelectOpt={(status) => (task.status = status.name)}
      />
      <Input type='date' defaultValue={task.dueDate} onChange={(e) => (task.dueDate = e.target.value)} className='h-7' />

      <Btn lbl='שמירה' size='small' className='h-7' icon='floppy-disk' onClick={saveTask} />

      <TaskTitleFormPop task={task} render={render} />
      <TaskCtxMenu render={render} onDelete={onDelete} editPopId='taskTitleForm' />
      {/* <PageEvents task={task} /> */}
    </div>
  )
}

function TaskTitleFormPop({ task, render }) {
  function onSave() {
    const title = (document.getElementById('taskTitle') as HTMLInputElement).value.trim()
    if (!title) return alert('יש להזין כותרת')

    task.title = title
    render()
    onTaskChange()
  }

  return (
    <div popover='auto' id='taskTitleForm' className='pop p-4'>
      <Input lbl='כותרת' defaultValue={task?.title} id='taskTitle' />
      <Btn lbl='שמירה' icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
    </div>
  )
}
