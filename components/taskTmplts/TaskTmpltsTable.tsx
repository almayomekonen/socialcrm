'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Link from 'next/link'
// import AddTaskTmpltBtn from './AddTaskTmpltBtn'
import Search from '@/lib/table/Search'
import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { addTaskTmplt } from '@/actions/tasks'

export type SaleTableProps = {
  props: {
    data: any[]
    tblPref: any
  }
}

export default function TaskTmpltsTable({ props }: SaleTableProps) {
  const { data, tblPref } = props

  const tblId = 'taskTmpltsTable12'
  const [state, setState] = useState([...data])

  const [columns, setColumns] = useState(tblPref?.[tblId] || saleTableHeaders)

  const config = {
    columns,
    setColumns,
    data,
    state,
    setState,
    funcs: {
      formatTitle,
    },
  } as ConfigT

  return (
    <div className='my-8'>
      <div className='flex justify-between gap-4'>
        <div className='flex gap-3 items-end mb-2'>
          <Search config={config} />
        </div>

        <div className='flex gap-4 items-end mb-2'>
          <AddTaskTmpltBtn />
        </div>
      </div>

      <Table config={config} tblCls='mb-0 rounded-b-none' />
    </div>
  )
}

const saleTableHeaders = [
  { key: 'title', label: 'כותרת', format: 'formatTitle' },
  { key: 'createdAt', label: 'תאריך יצירה', format: 'formatDate' },
]

function formatTitle(_, obj) {
  return (
    <Link href={`/settings/edit_tmplts/${obj.id}`} className='underline underline-offset-2 font-semibold'>
      {obj.title}
    </Link>
  )
}

function AddTaskTmpltBtn() {
  async function addAndRedirect() {
    const id = await addTaskTmplt()
    redirect(`/settings/edit_tmplts/${id}`)
  }

  // return <SubmitButton lbl='יצירת תבנית משימה חדשה' onClick={addAndRedirect} />
  return <Btn lbl='יצירת תבנית מעקב חדשה' icon='plus' onClick={addAndRedirect} />
}
