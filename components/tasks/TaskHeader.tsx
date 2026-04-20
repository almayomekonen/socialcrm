'use client'

import { Input } from '@/lib/form'
import { deleteTask, updateFullTask } from '../../actions/tasks'
import { useEffect, useRef, useState } from 'react'
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

type SavePayload = Partial<{
  title: string
  status: string
  completed: boolean
  userId: number
  dueDate: string
}>

export default function TaskHeader({ task, users }: TaskHeaderProps) {
  const [state, setState] = useState(false)
  const [title, setTitle] = useState<string>(task.title)
  const [status, setStatus] = useState<string>(task.status)
  const [completed, setCompleted] = useState<boolean>(task.completed)
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const { run } = useAction()
  const render = () => setState((s) => !s)

  const prevTaskId = useRef(task.id)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (task.id !== prevTaskId.current) {
      prevTaskId.current = task.id
      setTitle(task.title)
      setStatus(task.status)
      setCompleted(task.completed)
    }
  }, [task.id])

  async function autoSave(payload: SavePayload = {}) {
    await api(updateFullTask, { ...task, ...payload })
    onTaskChange()
    router.refresh()
  }

  async function handleStatusChange(newStatus: string) {
    if (saving) return
    setSaving(true)
    try {
      setStatus(newStatus)
      setCompleted(false)
      await autoSave({ status: newStatus, completed: false })
    } finally {
      setSaving(false)
    }
  }

  async function toggleComplete() {
    if (saving) return
    setSaving(true)
    try {
      const next = !completed
      setCompleted(next)
      await autoSave({ completed: next })
      router.push('/tasks')
    } finally {
      setSaving(false)
    }
  }

  async function handleUserChange(userId: number) {
    if (saving) return
    setSaving(true)
    try {
      await autoSave({ userId })
    } finally {
      setSaving(false)
    }
  }

  async function handleDueDateChange(dueDate: string) {
    if (saving) return
    setSaving(true)
    try {
      await autoSave({ dueDate })
    } finally {
      setSaving(false)
    }
  }

  async function handleTitleSave(newTitle: string) {
    if (saving) return
    setSaving(true)
    try {
      setTitle(newTitle)
      await autoSave({ title: newTitle })
    } finally {
      setSaving(false)
    }
  }

  function onDelete() {
    run(async () => {
      deleteTask(task)
      render()
      onTaskChange()
    })
  }

  return (
    <div className='space-y-5'>
      <div className='flex items-start justify-between gap-4'>
        <h2
          onContextMenu={onTaskCtxMenu}
          className='text-2xl font-semibold leading-tight tracking-tight text-gray-900'
        >
          {title}
        </h2>
        <Btn
          lbl={completed ? 'בטל סימון' : 'סמן כבוצע'}
          size='small'
          icon={completed ? 'x' : 'check'}
          variant={completed ? 'soft' : undefined}
          onClick={toggleComplete}
          disabled={saving}
        />
      </div>

      <div className='flex flex-wrap gap-3 items-center rounded-xl bg-gray-50 border border-gray-100 p-3'>
        <SelectSearch
          name='userId'
          placeholder='נציג'
          options={users}
          selected={task.userId}
          onSelectOpt={(user) => handleUserChange(user.id)}
        />
        <SelectSearch
          name='status'
          placeholder='סטטוס'
          options={statusOptions}
          selected={status}
          onSelectOpt={(opt) => handleStatusChange(opt.name)}
        />
        <Input
          type='date'
          defaultValue={task.dueDate}
          onChange={(e) => handleDueDateChange(e.target.value)}
          className='h-10'
        />
      </div>

      <TaskTitleFormPop title={title} onSave={handleTitleSave} saving={saving} />
      <TaskCtxMenu render={render} onDelete={onDelete} editPopId='taskTitleForm' />
    </div>
  )
}

function TaskTitleFormPop({
  title,
  onSave,
  saving,
}: {
  title: string
  onSave: (title: string) => Promise<void>
  saving: boolean
}) {
  const { loading, error, setError, run } = useAction()

  async function handleSave() {
    const newTitle = (document.getElementById('taskTitle') as HTMLInputElement).value.trim()
    if (!newTitle) {
      setError('יש להזין כותרת')
      return
    }
    await run(async () => {
      await onSave(newTitle)
      document.getElementById('taskTitleForm')?.hidePopover()
    })
  }

  return (
    <div popover='auto' id='taskTitleForm' className='pop p-4'>
      <Input key={title} lbl='כותרת' defaultValue={title} id='taskTitle' />
      {error && <p className='text-sm text-red-500 mt-1'>{error}</p>}
      <Btn
        lbl={loading || saving ? '...' : 'שמירה'}
        icon='floppy-disk'
        className='mt-2 w-full'
        onClick={handleSave}
        disabled={loading || saving}
      />
    </div>
  )
}
