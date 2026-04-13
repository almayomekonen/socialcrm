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

interface Props {
  clientId: string
  taskTmplts: any[]
  clients: any[]
  user: any
}

export default function AddTaskForm({ clientId, taskTmplts, clients, user }: Props) {
  const { loading, error, setError, run } = useAction()
  const router = useRouter()

  function getTitle() {
    const title = (document.getElementById('newTaskTitle') as HTMLInputElement)?.value?.trim()
    if (!title) { setError('יש להזין כותרת למעקב'); return null }
    return title
  }

  function getSelectedClientId() {
    const id = (document.getElementsByName('selectedClientId')?.[0] as any)?.value
    if (!id) { setError('יש לבחור ליד'); return null }
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
        <Title lbl='יצירת משימה חדשה' />
        <div className='grid gap-4 mt-4'>
          {!clientId && (
            <SelectSearch
              show='details'
              val='id'
              searchFunc={searchFunc}
              placeholder='בחירת ליד'
              name='selectedClientId'
              options={options}
              lbl='ליד'
            />
          )}

          <Input id='newTaskTitle' lbl='כותרת המעקב' placeholder='לדוגמה: מעקב אחר הצעת מחיר' />

          {error && <p className='text-sm text-red-500'>{error}</p>}

          <Btn lbl={loading ? '...' : 'יצירת משימה חדשה'} className='w-full' onClick={addAndRedirect} disabled={loading} />

          {taskTmplts?.length > 0 && (
            <form onSubmit={addAndRedirectFromTmplt} className='w-full'>
              <Select options={taskTmplts} name='taskTmpltId' lbl='או בחר מתבנית' val='id' show='title' />
              <Btn lbl={loading ? '...' : 'יצירת משימה מתבנית'} variant='outline' className='mt-2 w-full' disabled={loading} />
            </form>
          )}
        </div>
      </div>
    </>
  )
}
