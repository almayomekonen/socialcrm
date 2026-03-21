'use client'

import { redirect } from 'next/navigation'
import { addTask, addTaskFromTmplt } from '../../../actions/tasks'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { SelectSearch } from '@/lib/form/SelectSearch'
import Title from '@/lib/Title'
import { isAdmin } from '@/types/roles'
import { searchContacts } from '@/actions/clients'

interface Props {
  clientId: string
  taskTmplts: any[]
  clients: any[]
  user: any
}

export default function AddTaskForm({ clientId, taskTmplts, clients, user }: Props) {
  async function addAndRedirect() {
    if (clientId) {
      const id = await addTask(clientId, user)
      redirect(`/clients/${clientId}/tasks/${id}`)
    } else {
      const selectedClientId = (document.getElementsByName('selectedClientId')?.[0] as any).value
      if (!selectedClientId) return alert('יש לבחור ליד')
      const id = await addTask(selectedClientId, user)
      redirect(`/clients/${selectedClientId}/tasks/${id}`)
    }
  }

  async function addAndRedirectFromTmplt(e) {
    const formData = getFormData2(e) as any
    if (clientId) {
      const id = await addTaskFromTmplt(clientId, formData.taskTmpltId)
      redirect(`/clients/${clientId}/tasks/${id}`)
    } else {
      const selectedClientId = (document.getElementsByName('selectedClientId')?.[0] as any).value
      if (!selectedClientId) return alert('יש לבחור ליד')
      const id = await addTaskFromTmplt(selectedClientId, formData.taskTmpltId)
      redirect(`/clients/${selectedClientId}/tasks/${id}`)
    }
  }

  const searchFunc = isAdmin(user.role) ? searchContacts : null
  const options = isAdmin(user.role) ? [] : clients

  console.log('searchFunc', searchFunc)
  console.log('options', options)

  return (
    <>
      <div popover='auto' id='chooseTaskTmplt' className='pop p-4 w-96'>
        <Title lbl='יצירת מעקב חדש' />
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

          <form onSubmit={addAndRedirectFromTmplt} className='w-full'>
            <Select options={taskTmplts} name='taskTmpltId' lbl='בחר מעקב מתבנית' val='id' show='title' />
            <Btn lbl='יצירת מעקב מתבנית' className='mt-2 w-full ' />
          </form>

          <Btn lbl='יצירת מעקב חדש' variant='outline' className='mt-4 w-full' onClick={addAndRedirect} />
        </div>
      </div>
    </>
  )
}
