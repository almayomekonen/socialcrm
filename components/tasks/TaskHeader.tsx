'use client'

import { Input } from '@/lib/form'
import { deleteTask, updateFullTask } from '../../actions/tasks'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { statusOptions } from './SelectTasksStatus'
import { api } from '@/lib/funcs'
import { onTaskChange, onTaskCtxMenu, TaskCtxMenu } from './utils'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { useAction } from '@/lib/useAction'

type TaskHeaderProps = {
  task: any
  users: any[]
}

export default function TaskHeader({ task, users }: TaskHeaderProps) {
  const [state, setState] = useState(false)
  const [completed, setCompleted] = useState(task.completed)
  const router = useRouter()
  const { run } = useAction()
  const render = () => setState(!state)

  async function autoSave() {
    await api(updateFullTask, task)
    onTaskChange()
  }

  async function toggleComplete() {
    const next = !completed
    task.completed = next
    setCompleted(next)
    await api(updateFullTask, task)
    router.push('/tasks')
  }

  function onDelete() {
    run(async () => {
      deleteTask(task)
      render()
      onTaskChange()
    })
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-start justify-between gap-4'>
        <h2 onContextMenu={onTaskCtxMenu} className='text-2xl font-bold leading-tight'>
          {task.title}
        </h2>
        <Btn
          lbl={completed ? 'בטל סימון' : 'סמן כבוצע'}
          size='small'
          icon={completed ? 'x' : 'check'}
          variant={completed ? 'soft' : undefined}
          onClick={toggleComplete}
        />
      </div>

      <div className='flex flex-wrap gap-3 items-center'>
        <SelectSearch
          name='userId'
          placeholder='גורם מטפל'
          options={users}
          selected={task.userId}
          onSelectOpt={async (user) => {
            task.userId = user.id
            await autoSave()
          }}
        />
        <SelectSearch
          name='status'
          placeholder='סטטוס'
          options={statusOptions}
          selected={task.status}
          onSelectOpt={async (status) => {
            task.status = status.name
            await autoSave()
          }}
        />
        <Input
          type='date'
          defaultValue={task.dueDate}
          onChange={async (e) => {
            task.dueDate = e.target.value
            await autoSave()
          }}
          className='h-9'
        />
      </div>

      <TaskTitleFormPop task={task} autoSave={autoSave} render={render} />
      <TaskCtxMenu render={render} onDelete={onDelete} editPopId='taskTitleForm' />
    </div>
  )
}

function TaskTitleFormPop({ task, autoSave, render }) {
  const { loading, error, setError, run } = useAction()

  async function onSave() {
    const title = (document.getElementById('taskTitle') as HTMLInputElement).value.trim()
    if (!title) { setError('יש להזין כותרת'); return }
    await run(async () => {
      task.title = title
      render()
      await autoSave()
      document.getElementById('taskTitleForm')?.hidePopover()
    })
  }

  return (
    <div popover='auto' id='taskTitleForm' className='pop p-4'>
      <Input lbl='כותרת' defaultValue={task?.title} id='taskTitle' />
      {error && <p className='text-sm text-red-500 mt-1'>{error}</p>}
      <Btn lbl={loading ? '...' : 'שמירה'} icon='floppy-disk' className='mt-2 w-full' onClick={onSave} disabled={loading} />
    </div>
  )
}
