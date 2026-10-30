'use client'

import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateFullTaskTmplt } from '@/actions/tasks'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SaveTaskTmplt({ taskTmplt }) {
  const t = useT()
  async function saveTaskTmplt() {
    api(updateFullTaskTmplt, [taskTmplt])
  }
  return (
    <div className=''>
      <Btn lbl={t('admin.taskTmplts.save')} icon='floppy-disk' className=' mx-auto' onClick={saveTaskTmplt} />
    </div>
  )
}
