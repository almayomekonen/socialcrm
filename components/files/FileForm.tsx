'use client'
import Title from '../../lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { addFilesToTask } from '../../actions/files'
import { api } from '@/lib/funcs'
import FileUploader from './FileUploader'
import { useState } from 'react'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function FileForm({ clientId, tasks }) {
  const [taskId, setTaskId] = useState(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onSubmit(e) {
    const data = getFormData2(e)
    data.files = JSON.parse(data.files)
    if (!data.files.length) return setErrMsg('יש להעלות קבצים')

    if (data.taskId) api(addFilesToTask, [data, clientId])
  }

  return (
    <div popover='manual' id='filePopover' className='pop overflow-hidden w-[450px] relative'>
      <Btn variant='sign' size='sign' className='absolute top-4 left-4' icon='circle-x' popoverTarget='filePopover' />
      <form onSubmit={onSubmit} className='space-y-4'>
        <Title lbl='הוספת קבצים חדשים' />
        <p className='col-span-2 pt-4 py-1'>קישור למעקב (אופציונלי):</p>
        <SelectSearch
          onSelectOpt={(task) => setTaskId(task.id)}
          name='taskId'
          options={tasks}
          show='title'
          val='id'
          lbl='מעקב'
          key={`tasks-${tasks.length}`}
        />
        <FileUploader tooltipClass='h-30' path={`${clientId}/${taskId ?? 'unassigned'}`} clientId={clientId} taskId={taskId} />
        <Btn lbl='הוספה' className='w-full' />
      </form>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </div>
  )
}
