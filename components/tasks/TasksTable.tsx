'use client'

import { useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import ExportTable from '@/lib/table/export'
import Table, { ConfigT } from '@/lib/table'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isDatePassed } from './ClientTasksTable'
import SelectTasksStatus from './SelectTasksStatus'
import { getFormData2 } from '@/lib/form/funcs'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { saveTblPref } from '@/actions/global'

export default function TasksTable({ data, users, filter, user, fillHeight = false }) {
  const safeData = Array.isArray(data) ? data : []
  const [state, setState] = useState<any[]>(safeData)
  const tblId = 'tasksTable435'
  const [columns, setColumns] = useState(user?.tblPref?.[tblId] || headers)

  const config = {
    tblId,
    columns,
    setColumns,
    data: safeData,
    state,
    setState,
    funcs: { formatTitle, isDatePassed },
    getColumns(columns) {
      saveTblPref(tblId, columns)
    },
  } as ConfigT

  async function onFilter(e) {
    const formData = getFormData2(e) as any
    redirect(`?filter=${JSON.stringify(formData)}`)
  }

  const taskCount = state.length
  const completedCount = state.filter((t) => t.completed).length
  const activeCount = taskCount - completedCount
  const overdueCount = state.filter((t) => !t.completed && t.dueDate && new Date(t.dueDate) < new Date()).length

  return (
    <>
      <div className={fillHeight ? 'flex flex-col min-h-0 flex-1' : 'grid'}>
        <div className={`flex items-end justify-between mb-2 ${fillHeight ? 'shrink-0' : ''}`}>
          <div className='flex gap-2 items-end'>
            <Search config={config} />
            <ShowColumns config={config} />
            <Select options={[]} val='func' placeholder='פעולות' />

            <form onSubmit={onFilter} className='flex items-end gap-2'>
              <SelectTasksStatus defaultValue={filter.status} />
              <SelectSearch lbl='נציגים' name='userId' options={users} selected={filter.userId} className='w-52' />
              <div className='flex gap-0'>
                <Btn className='rounded-e-none gap-4 px-6' type='submit' lbl='סינון' variant='outline' />
                <Btn variant='outline' size='icon' icon='eraser' href='?' scroll={false} className='rounded-s-none border-s-0' />
              </div>
            </form>
          </div>

          <div className='flex items-center gap-2'>
            <ExportTable data={state} columns={columns} />
            <Btn lbl='משימה חדשה' icon='plus' popoverTarget='chooseTaskTmplt' />
          </div>
        </div>

        <Table config={config} tblCls={fillHeight && (state?.length ?? 0) > 0 ? 'mb-0 rounded-b-none tbl-fill' : 'mb-0 rounded-b-none'} />
        {(state?.length ?? 0) === 0 && (
          <div className={`flex items-center justify-center text-gray-400 ${fillHeight ? 'flex-1' : 'h-48'}`}>אין משימות עדיין</div>
        )}
        {fillHeight && taskCount > 0 && (
          <div className='shrink-0 flex items-center justify-between p-4 bg-white border border-t-0 rounded-b-md w-full text-sm'>
            <p className='font-medium'>{`${taskCount} משימות`}</p>
            <div className='flex items-center gap-4 text-gray-500'>
              <span>{`${activeCount} פעילות`}</span>
              <span>{`${completedCount} הושלמו`}</span>
              {overdueCount > 0 && <span className='font-medium text-red-600'>{`${overdueCount} באיחור`}</span>}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export const headers = [
  { key: 'title', label: 'מעקב', format: 'formatTitle' },
  { key: 'status', label: 'סטטוס' },
  { key: 'clientName', label: 'ליד' },
  { key: 'completed', label: 'הושלם' },
  { key: 'userName', label: 'נציג' },
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
