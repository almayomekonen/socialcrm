'use client'

import { useRouter } from 'next/navigation'
import { addTask, addTaskFromTmplt } from '../../../actions/tasks'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { SelectSearch } from '@/lib/form/SelectSearch'
import Title from '@/lib/Title'
import { isAdmin } from '@/types/roles'
import { searchContacts } from '@/actions/clients'
import { useAction } from '@/lib/useAction'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

interface Props {
  clientId: string
  taskTmplts: any[]
  clients: any[]
  user: any
  /**
   * The caller's screen follows the interface language (the lead tasks tab).
   * Off: Hebrew, as on the untranslated global /tasks page. The popover sits
   * inside the caller's page root, so it inherits that region's direction.
   * A failed action shows `useAction`'s own (shared, Hebrew) text.
   */
  translated?: boolean
}

export default function AddTaskForm({ clientId, taskTmplts, clients, user, translated = false }: Props) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const { loading, error, setError, run } = useAction({ translated })
  const router = useRouter()

  function getTitle() {
    const title = (document.getElementById('newTaskTitle') as HTMLInputElement)?.value?.trim()
    if (!title) { setError(t('leadTabs.tasks.form.titleRequired')); return null }
    return title
  }

  function getSelectedClientId() {
    const id = (document.getElementsByName('selectedClientId')?.[0] as any)?.value
    if (!id) { setError(t('leadTabs.tasks.form.leadRequired')); return null }
    return id
  }

  async function addAndRedirect() {
    const title = getTitle()
    if (!title) return
    const resolvedClientId = clientId || getSelectedClientId()
    if (!resolvedClientId) return
    await run(async () => {
      const id = await addTask(resolvedClientId, user, title)
      document.getElementById('chooseTaskTmplt')?.hidePopover()
      router.push(`/clients/${resolvedClientId}/tasks/${id}`)
    })
  }

  async function addAndRedirectFromTmplt(e) {
    const formData = getFormData2(e) as any
    const resolvedClientId = clientId || getSelectedClientId()
    if (!resolvedClientId) return
    await run(async () => {
      const id = await addTaskFromTmplt(resolvedClientId, formData.taskTmpltId)
      document.getElementById('chooseTaskTmplt')?.hidePopover()
      router.push(`/clients/${resolvedClientId}/tasks/${id}`)
    })
  }

  const searchFunc = isAdmin(user.role) ? searchContacts : null
  const options = isAdmin(user.role) ? [] : clients

  return (
    <>
      <div popover='auto' id='chooseTaskTmplt' className='pop p-4 w-96'>
        <Title lbl={t('leadTabs.tasks.form.title')} />
        <div className='grid gap-4 mt-4'>
          {!clientId && (
            <SelectSearch
              show='details'
              val='id'
              searchFunc={searchFunc}
              placeholder={t('leadTabs.tasks.form.leadPlaceholder')}
              name='selectedClientId'
              options={options}
              lbl={t('leadTabs.tasks.form.leadLabel')}
            />
          )}

          <Input id='newTaskTitle' lbl={t('leadTabs.tasks.form.taskTitleLabel')} placeholder={t('leadTabs.tasks.form.taskTitlePlaceholder')} />

          {error && <p className='text-sm text-red-500'>{error}</p>}

          <Btn lbl={loading ? '...' : t('leadTabs.tasks.form.create')} className='w-full' onClick={addAndRedirect} disabled={loading} />

          {taskTmplts?.length > 0 && (
            <form onSubmit={addAndRedirectFromTmplt} className='w-full'>
              <Select options={taskTmplts} name='taskTmpltId' lbl={t('leadTabs.tasks.form.templateLabel')} val='id' show='title' />
              <Btn lbl={loading ? '...' : t('leadTabs.tasks.form.createFromTemplate')} variant='outline' className='mt-2 w-full' disabled={loading} />
            </form>
          )}
        </div>
      </div>
    </>
  )
}
