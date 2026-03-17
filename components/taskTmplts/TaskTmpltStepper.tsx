'use client'

import { Btn } from '@/lib/btns/Btn'
import { useEffect, useState } from 'react'
import { Input } from '@/lib/form'
import Icon from '@/lib/Icon'
import { useDrag } from '@/lib/hooksNEvents'

let crntTask = null,
  editTask = null,
  editSubTask = null,
  stepMenu = null,
  subTaskMenu = null,
  stepForm = null,
  subTaskForm = null,
  taskTmpltId

export default function TaskTmpltStepper({ tasks, taskTmpltIdProp }) {
  const [state, setState] = useState(false)
  const render = () => setState(!state)

  useEffect(() => {
    stepMenu = document.getElementById('stepMenuTmplt')
    subTaskMenu = document.getElementById('subTaskMenuTmplt')
    stepForm = document.getElementById('stepFormTmplt')
    subTaskForm = document.getElementById('subTaskFormTmplt')
    crntTask = tasks[0]
    render()
    taskTmpltId = taskTmpltIdProp
  }, [])

  return (
    <>
      <div className='flex gap-0  my-4'>
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
          popoverTarget='stepFormTmplt'
          className='bg-soft-green end-step ps-4 pe-3 py-1 text-white font-bold rounded cursor-pointer'
        >
          +
        </button>
      </div>
      {crntTask && (
        <Btn variant='outline' lbl='תת-משימה' icon='plus' className='my-1' size='small' popoverTarget='subTaskFormTmplt' />
      )}
      <div className='max-h-72 h-72 overflow-y-auto ' key={crntTask?.title}>
        {crntTask &&
          crntTask?.subTasks.map((subtask, i) => (
            <ChecklistItem key={subtask.title} subtask={subtask} tasks={tasks} {...useDrag(crntTask.subTasks, i, render)} />
          ))}
      </div>

      <StepMenuPop tasks={tasks} render={render} />
      <SubTaskMenuPop tasks={tasks} render={render} />
      <StepFormPop tasks={tasks} key={Math.random()} render={render} />
      <SubTaskFormPop tasks={tasks} key={Math.random()} render={render} />
    </>
  )
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
      className={`mid-step ps-5 pe-4 py-1 text-white -me-[5px] first:start-step first:ps-3 rounded cursor-pointer ${
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

function ChecklistItem({ subtask, tasks, ...props }) {
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
      className='border py-2 px-3 mt-2 rounded has-[input:checked]:bg-soft has-[input:checked]:border-solid cursor-pointer'
      {...props}
    >
      <div className='flex gap-2'>
        <input disabled type='checkbox' className='accent-solid size-4' defaultChecked={subtask.isCompleted} onChange={onCheck} />
        <p>{subtask.title}</p>
      </div>
      <p className='text-sm text-gray-600 ps-6'>{subtask.desc}</p>
    </label>
  )
}

function StepMenuPop({ tasks, render }) {
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
        id='stepMenuTmplt'
        className='bg-white/70 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
      >
        <div className='*:border-b text-sm *:hover:bg-gray-200 *:justify-center *:w-full w-21 *:py-2 *:last:border-b-0'>
          <button className='flex gap-2' popoverTarget='stepFormTmplt' onClick={render}>
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

function SubTaskMenuPop({ tasks, render }) {
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
      id='subTaskMenuTmplt'
      className='bg-white/70 backdrop-blur border rounded-xl shadow-2xl m-0 inset-auto absolute overflow-hidden'
    >
      <div className='*:border-b text-sm *:hover:bg-gray-200 *:justify-center *:w-full w-21 *:py-2 *:last:border-b-0'>
        <button className='flex gap-2' popoverTarget='subTaskFormTmplt' onClick={render}>
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

function StepFormPop({ tasks, render }) {
  function onSave() {
    const title = (document.getElementById('stepTitleTmplt') as HTMLInputElement).value.trim()

    if (!title) return alert('יש להזין כותרת')
    // check if task title is unique
    if (title !== editTask?.title && tasks.some((t) => t.title === title)) return alert(`הכותרת "${title}" כבר קיימת`)

    editTask ? (editTask.title = title) : tasks.push({ title, subTasks: [] })
    // update task
    render()
    // save task to db
    editTask = null
    clearPopover()
  }

  return (
    <div popover='auto' id='stepFormTmplt' className='pop p-4'>
      <Input lbl='כותרת השלב' defaultValue={editTask?.title} id='stepTitleTmplt' />
      <Btn lbl='שמירה' icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
    </div>
  )
}

function SubTaskFormPop({ tasks, render }) {
  function onSave() {
    const title = (document.getElementById('subTaskTitleTmplt') as HTMLInputElement).value.trim()
    const desc = (document.getElementById('subTaskDescTmplt') as HTMLTextAreaElement).value.trim()

    if (!title) return alert('יש להזין כותרת')

    if (editSubTask) {
      editSubTask.title = title
      editSubTask.desc = desc
    } else {
      crntTask.subTasks.push({ title, desc, isCompleted: false })
    }

    render()
    editSubTask = null
    clearPopover()
  }

  return (
    <div popover='auto' id='subTaskFormTmplt' className='pop p-4'>
      <Input lbl='כותרת תת-המשימה' defaultValue={editSubTask?.title} id='subTaskTitleTmplt' />
      <Input as='textarea' lbl='תיאור' defaultValue={editSubTask?.desc} id='subTaskDescTmplt' rows={3} />
      <Btn lbl='שמירה' icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
    </div>
  )
}

function clearPopover() {
  stepMenu.hidePopover()
  subTaskMenu.hidePopover()
  stepForm.hidePopover()
  subTaskForm.hidePopover()
}
