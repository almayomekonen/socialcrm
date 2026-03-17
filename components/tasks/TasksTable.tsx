'use client'

import { useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import ExportTable from '@/lib/table/export'
import Table, { ConfigT } from '@/lib/table'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import Link from 'next/link'
import { isDatePassed } from './ClientTasksTable'
import { redirect } from 'next/navigation'
import SelectTasksStatus from './SelectTasksStatus'
import { getFormData2 } from '@/lib/form/funcs'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { saveTblPref } from '@/actions/global'

export default function TasksTable({ data, users, filter, user }) {
  const [state, setState] = useState(data)
  const tblId = 'tasksTable435'
  const [columns, setColumns] = useState(user?.tblPref?.[tblId] || headers)

  const config = {
    tblId,
    columns,
    setColumns,
    data,
    state,
    setState,
    funcs: { formatTitle, isDatePassed },
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
  } as ConfigT

  async function loadMore() {
    redirect(`?filter=${JSON.stringify({ ...filter, skip: filter.skip + 1 })}`)
  }
  async function onFilter(e) {
    const formData = getFormData2(e) as any
    redirect(`?filter=${JSON.stringify(formData)}`)
  }

  return (
    <>
      <div className='grid'>
        <div className='flex items-end justify-between mb-2'>
          <div className='flex gap-2 items-end'>
            <Search config={config} />
            <ShowColumns config={config} />
            <Select options={[]} val='func' placeholder='פעולות' />

            <form onSubmit={onFilter} className='flex items-end gap-2'>
              <SelectTasksStatus defaultValue={filter.status} />
              <SelectSearch lbl='סוכנים' name='userId' options={users} selected={filter.userId} className='w-52' />
              <div className='flex gap-0'>
                <Btn className='rounded-e-none gap-4 px-6' type='submit' lbl='סינון' variant='outline' />
                <Btn variant='outline' size='icon' icon='eraser' href='?' scroll={false} className='rounded-s-none border-s-0' />
              </div>
            </form>
          </div>

          <div className='flex '>
            <ExportTable data={state} columns={columns} />
            <Btn lbl='משימה חדשה' icon='plus' popoverTarget='chooseTaskTmplt' />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />
        <Btn lbl='טען עוד...' size='small' onClick={loadMore} variant='outline' className='mt-2 w-fit' />
      </div>
    </>
  )
}

export const headers = [
  { key: 'title', label: 'משימה', format: 'formatTitle' },
  { key: 'status', label: 'סטטוס' },
  { key: 'clientName', label: 'לקוח' },
  { key: 'completed', label: 'הושלם' },
  { key: 'userName', label: 'גורם מטפל' },
  { key: 'dueDate', label: 'תאריך יעד', format: 'isDatePassed' },
  { key: 'createdAt', label: 'תאריך יצירה', format: 'formatDate' },
  { key: 'updatedAt', label: 'תאריך פעילות אחרון', format: 'formatDate' },
]

function formatTitle(_, obj) {
  return (
    <Link href={`/clients/${obj.clientId}/tasks/${obj.id}`} className='font-semibold underline underline-offset-2'>
      {obj.title}
    </Link>
  )
}
