'use client'

import { Input } from '@/lib/form'
import Icon from '@/lib/Icon'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import SaveTaskTmplt from './SaveTaskTmplt'
import { deleteTaskTmplt } from '@/actions/tasks'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
  const [confirmDel, setConfirmDel] = useState(false)

  function onDelete() {
    document.getElementById('taskTmpltTitleMenu')?.hidePopover?.()
    setConfirmDel(true)
  }

  function performDelete() {
    setConfirmDel(false)
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
            <p>{t('admin.taskTmplts.menu.edit')}</p>
          </button>
          <button className='flex gap-2 hover:!bg-red-100!' onClick={onDelete}>
            <Icon name='trash' className='size-3' />
            <p>{t('admin.taskTmplts.menu.delete')}</p>
          </button>
        </div>
      </div>
      <ConfirmPop
        open={confirmDel}
        destructive
        onClose={() => setConfirmDel(false)}
        onConfirm={performDelete}
        msg={t('admin.taskTmplts.headerDeleteConfirm', { title: String(taskTmplt.title) })}
        translated
      />
    </>
  )
}

function TaskTmpltTitleFormPop({ taskTmplt, render }) {
  const t = useT()
  const [errMsg, setErrMsg] = useState<string | null>(null)

  function onSave() {
    const title = (document.getElementById('taskTmpltTitle') as HTMLInputElement).value.trim()

    if (!title) return setErrMsg(t('admin.taskTmplts.titleRequired'))

    taskTmplt.title = title
    // update task template
    render()
    document.getElementById('taskTmpltTitleForm').hidePopover()
    document.getElementById('taskTmpltTitleMenu').hidePopover()
  }

  return (
    <div popover='auto' id='taskTmpltTitleForm' className='pop p-4'>
      <Input lbl={t('admin.taskTmplts.titleLabel')} defaultValue={taskTmplt?.title} id='taskTmpltTitle' />
      <Btn lbl={t('common.save')} icon='floppy-disk' className='mt-2 w-full' onClick={onSave} />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
    </div>
  )
}
