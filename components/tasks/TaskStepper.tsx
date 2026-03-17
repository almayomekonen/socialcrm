'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/lib/form'
import Icon from '@/lib/Icon'
import { useDrag } from '@/lib/hooksNEvents'
import { Task, TaskItem } from '@/types/db/tables'
import { Btn } from '@/lib/btns/Btn'

let crntTask: TaskItem | null = null,
  editTask = null,
  editSubTask = null,
  stepMenu = null,
  subTaskMenu = null,
  stepForm = null,
  subTaskForm = null,
  hasMounted = false

interface Props {
  task: Task
  initIndex: number
}

export default function TaskStepper({ task, initIndex }: Props) {
  const tasks = task.tasks
  const [state, setState] = useState(false)
  const render = () => setState(!state)

  //  if (!crntTask) crntTask = initTask
  if (!hasMounted) crntTask = tasks[initIndex]

  useEffect(() => {
    stepMenu = document.getElementById('stepMenu')
    subTaskMenu = document.getElementById('subTaskMenu')
    stepForm = document.getElementById('stepForm')
    subTaskForm = document.getElementById('subTaskForm')

    hasMounted = true

    return () => {
      crntTask = null
      hasMounted = false
      editTask = null
      editSubTask = null
    }
  }, [])

  return (
    <>
      <div className='flex gap-0' style={{ gridArea: 'stepper' }}>
        {tasks?.map((task, i) => (
          <Step
            key={task.title}
            task={task}
            onClick={() => {
              crntTask = task
              render()
            }}
            isActive={crntTask?.title === task.title}
            {...useDrag(tasks, i, render)}
          />
        ))}
        <button
          popoverTarget='stepForm'
          className='bg-soft-green end-step ps-4 pe-3 py-1 text-white font-bold rounded cursor-pointer'
        >
          +
        </button>
      </div>

      <div className='' key={crntTask?.title} style={{ gridArea: 'subtasks' }}>
        {crntTask?.subTasks.map((subtask, i) => (
          <ChecklistItem
            key={subtask.title}
            crntTask={crntTask}
            subtask={subtask}
            tasks={tasks}
            {...useDrag(crntTask.subTasks, i, render)}
          />
        ))}
        {crntTask && (
          <Btn variant='outline' lbl='תת-משימה' icon='plus' className='my-2' size='small' popoverTarget='subTaskForm' />
        )}
      </div>

      <StepMenuPop tasks={tasks} render={render} />
      <SubTaskMenuPop crntTask={crntTask} render={render} />
      <StepFormPop tasks={tasks} key={Math.random()} render={render} />
      <SubTaskFormPop crntTask={crntTask} key={Math.random()} render={render} />
    </>
  )

  // #7fb6bf
}

// Components ---------------------------------------------------------------------------------------------

function Step({ onClick, isActive, task, ...props }) {
  function onContextMenu(e) {
    e.preventDefault()
    editTask = task
    // show popover
    stepMenu.style.left = `${e.clientX}px`
    stepMenu.style.top = `${e.clientY}px`
    stepMenu.showPopover()
  }

  return (
    <button
      className={`mid-step ps-5 pe-4 py-1  text-white -me-[5px] first:start-step first:ps-3 rounded cursor-pointer ${
        isActive ? 'bg-solid-green' : task.isCompleted ? 'bg-black/35' : 'bg-soft-green'
      }`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...props}
    >
      {task.title}
    </button>
  )
}

interface ChecklistItemProps {
  crntTask: TaskItem
  subtask: TaskItem['subTasks'][number]
  tasks: TaskItem[]
}

function ChecklistItem({ crntTask, subtask, tasks, ...props }: ChecklistItemProps) {
  const onCheck = (e) => {
    subtask.isCompleted = e.target.checked
    crntTask.isCompleted = crntTask.subTasks.every((s) => s.isCompleted)
  }

  function onContextMenu(e) {
    e.preventDefault()
    editSubTask = subtask
    // show popover
    subTaskMenu.style.left = `${e.clientX}px`
    subTaskMenu.style.top = `${e.clientY}px`
    subTaskMenu.showPopover()
  }

  return (
    <label
      onContextMenu={onContextMenu}
      className='border py-2 px-3 mb-2 rounded has-[input:checked]:bg-soft has-[input:checked]:border-solid cursor-pointer'
      {...props}
    >
      <div className='flex gap-2'>
        <input type='checkbox' className='accent-solid size-4' defaultChecked={subtask.isCompleted} onChange={onCheck} />
        <p>{subtask.title}</p>
      </div>
      <p className='text-sm text-gray-600 ps-6'>{subtask.desc}</p>
    </label>
  )
}

function StepMenuPop({ tasks, render }: { tasks: TaskItem[]; render: () => void }) {
  function onDelete() {
    if (!confirm(`האם למחוק את המשימה "${editTask?.title}"?`)) return
    // delete task
    tasks.splice(tasks.indexOf(editTask), 1)
    render()
    clearPopover()
  }
  return (
    <>
      <div
        popover='auto'
        id='stepMenu'
        className='bg-white/70 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
      >
        <div className='*:border-b text-sm *:hover:bg-gray-200 *:justify-center *:w-full w-21 *:py-2 *:last:border-b-0'>
          <button className='flex gap-2' popoverTarget='stepForm' onClick={render}>
            <Icon name='pen' className='size-3' />
            <p>עריכה</p>
          </button>
          <button className='flex gap-2 hover:!bg-red-100' onClick={onDelete}>
            <Icon name='trash' className='size-3' />
            <p>מחיקה</p>
          </button>
        </div>
      </div>
    </>
  )
}

function SubTaskMenuPop({ crntTask, render }: { crntTask: TaskItem; render: () => void }) {
  function onDelete() {
    if (!confirm(`האם למחוק את המשימה "${editSubTask?.title}"?`)) return
    // delete task
    crntTask.subTasks.splice(crntTask.subTasks.indexOf(editSubTask), 1)
    render()
    clearPopover()
  }
  return (
    <div
      popover='auto'
      id='subTaskMenu'
      className='bg-white/70 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
    >
      <div className='*:border-b text-sm *:hover:bg-gray-200 *:justify-center *:w-full w-21 *:py-2 *:last:border-b-0'>
        <button className='flex gap-2' popoverTarget='subTaskForm' onClick={render}>
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

function StepFormPop({ tasks, render }: { tasks: TaskItem[]; render: () => void }) {
  function onSave() {
    const title = (document.getElementById('stepTitle') as HTMLInputElement).value.trim()

    if (!title) return alert('יש להזין כותרת')
    // check if task title is unique
    if (title !== editTask?.title && tasks.some((t) => t.title === title)) return alert(`הכותרת "${title}" כבר קיימת`)

    editTask ? (editTask.title = title) : tasks.push({ title, subTasks: [], isCompleted: false })
    // update task
    render()
    // save task to db
    editTask = null
    clearPopover()
  }

  return (
    <div popover='auto' id='stepForm' className='pop p-4'>
      <Input lbl='כותרת' defaultValue={editTask?.title} id='stepTitle' />
      <Btn lbl='שמירה' icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
    </div>
  )
}

function SubTaskFormPop({ crntTask, render }: { crntTask: TaskItem; render: () => void }) {
  function onSave() {
    const title = (document.getElementById('subTaskTitle') as HTMLInputElement).value.trim()
    const desc = (document.getElementById('subTaskDesc') as HTMLInputElement).value

    if (!title) return alert('יש להזין כותרת')

    if (title !== editSubTask?.title && crntTask.subTasks.some((t) => t.title === title))
      return alert(`הכותרת "${title}" כבר קיימת`)

    if (editSubTask) {
      editSubTask.title = title
      editSubTask.desc = desc
      editSubTask = null
    } else {
      crntTask.subTasks.push({ title, desc, isCompleted: false })
    }

    render()
    clearPopover()
  }
  return (
    <div popover='auto' id='subTaskForm' className='pop p-4 w-90'>
      <Input lbl='כותרת' defaultValue={editSubTask?.title} id='subTaskTitle' />
      <Input as='textarea' lbl='תיאור' defaultValue={editSubTask?.desc} id='subTaskDesc' />
      <Btn lbl='שמירה' icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
    </div>
  )
}

function clearPopover() {
  stepMenu.hidePopover()
  subTaskMenu.hidePopover()
  stepForm.hidePopover()
  subTaskForm.hidePopover()
  editTask = null
  editSubTask = null
}
