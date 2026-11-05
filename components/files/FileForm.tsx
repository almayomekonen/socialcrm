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
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

/** Upload form of the lead files tab; follows the interface language. Task titles are data. */
export default function FileForm({ clientId, tasks }) {
  const t = useT()
  const [taskId, setTaskId] = useState(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onSubmit(e) {
    const data = getFormData2(e)
    data.files = JSON.parse(data.files)
    if (!data.files.length) return setErrMsg(t('leadTabs.files.form.noFiles'))

    if (data.taskId) api(addFilesToTask, [data, clientId])
  }

  return (
    <div popover='manual' id='filePopover' className='pop overflow-hidden w-[450px] relative'>
      {/* Icon-only, named in every language (final UI audit, owner-approved Hebrew a11y change). Sits at the
          dialog's end corner: left in RTL, right in English. */}
      <Btn
        variant='sign'
        size='sign'
        className={dirFor(t.locale) === 'ltr' ? 'absolute top-4 right-4' : 'absolute top-4 left-4'}
        icon='circle-x'
        popoverTarget='filePopover'
        aria-label={t('common.dialog.close')}
      />
      <form onSubmit={onSubmit} className='space-y-4'>
        <Title lbl={t('leadTabs.files.form.title')} />
        <p className='col-span-2 pt-4 py-1'>{t('leadTabs.files.form.taskLink')}</p>
        <SelectSearch
          onSelectOpt={(task) => setTaskId(task.id)}
          name='taskId'
          options={tasks}
          show='title'
          val='id'
          lbl={t('leadTabs.files.form.taskLabel')}
          key={`tasks-${tasks.length}`}
        />
        <FileUploader
          tooltipClass='h-30'
          clientId={clientId}
          taskId={taskId}
          translated
        />
        <Btn lbl={t('leadTabs.files.form.submit')} className='w-full' />
      </form>
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
