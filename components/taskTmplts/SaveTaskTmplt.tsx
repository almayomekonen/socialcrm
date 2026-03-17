'use client'

import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateFullTaskTmplt } from '@/actions/tasks'

export default function SaveTaskTmplt({ taskTmplt }) {
  async function saveTaskTmplt() {
    api(updateFullTaskTmplt, [taskTmplt])
  }
  return (
    <div className=''>
      <Btn lbl='שמירת שינויים' icon='floppy-disk' className=' mx-auto' onClick={saveTaskTmplt} />
    </div>
  )
}
