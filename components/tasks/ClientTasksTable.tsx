'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import { Select } from '@/lib/form'
import { formatDate } from '@/lib/dates'
import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'
import SelectTasksStatus from './SelectTasksStatus'

export type SaleTableProps = {
  props: {
    data: any[]
    tblPref: any
    users: any[]
    clientId: string
    taskTmplts: any[]
  }
}
let selectedStatus = ''
let selectedUser = ''

export default function ClientTasksTable({ props }: SaleTableProps) {
  const { data, tblPref, users, clientId, taskTmplts } = props

  const tblId = 'clientTasksTable12'
  const [state, setState] = useState([...data])

  const [columns, setColumns] = useState(tblPref?.[tblId] || saleTableHeaders)

  // Filter function
  const handleStatusFilter = (status) => {
    selectedStatus = status
    if (!status || status === 'סטטוס') {
      // Show all data when no status is selected or default option is selected
      setState([...data])
    } else {
      // Filter data based on selected status
      const filteredData = data.filter((item) => item.status === status)
      setState(filteredData)
    }
  }

  const handleUserFilter = (e) => {
    selectedUser = e.target.value
    if (!selectedUser || selectedUser === 'גורם מטפל') {
      setState([...data])
    } else {
      const filteredData = data.filter((item) => item.userName === selectedUser)
      setState(filteredData)
    }
  }

  const config = {
    columns,
    setColumns,
    data,
    state,
    setState,
    funcs: {
      isDatePassed,
      formatTitle,
    },
  } as ConfigT

  return (
    <div className='my-8'>
      <div className='flex justify-between gap-4'>
        <div className='flex gap-3 items-end mb-2'>
          {/* <Search config={config} /> */}
          {/* <ShowColumns config={config} /> */}
          {/* <Btn variant='outline' lbl='סינון' popoverTarget='filterPop' icon='filter' /> */}
          <SelectTasksStatus defaultValue={selectedStatus} onChange={handleStatusFilter} />
          <Select
            placeholder='גורם מטפל'
            options={users}
            defaultValue={selectedUser}
            onChange={handleUserFilter}
            className='w-52'
          />
        </div>

        <div className='flex gap-4 items-end mb-2'>
          {/* <Btn variant='outline' lbl='איפוס סינון' icon='eraser' href='?' className='gap-4' /> */}
          {/* <FilterBtn /> */}
          <Btn lbl='צור מעקב חדש' icon='plus' popoverTarget='chooseTaskTmplt' />
          {/* <Btn lbl='הוספת משימה' popoverTarget='popSaleForm' icon='plus' /> */}
        </div>
      </div>

      <Table config={config} tblCls='mb-0 rounded-b-none' />
      {/* <SalesTableFooter props={props} /> */}
    </div>
  )
}

async function onDel(sale) {
  if (!confirm(`בטוח למחוק דיל של ${sale?.clientData} ?`)) return
  //   await api(deleteSale, sale?.id, 'המכירה נמחקה בהצלחה')
}

const saleTableHeaders = [
  { key: 'title', label: 'כותרת', format: 'formatTitle' },
  { key: 'status', label: 'סטטוס' },
  { key: 'userName', label: 'גורם מטפל' },
  { key: 'completed', label: 'הושלם' },
  { key: 'dueDate', label: 'תאריך יעד', format: 'isDatePassed' },
  { key: 'createdAt', label: 'תאריך יצירה', format: 'formatDate' },
  { key: 'updatedAt', label: 'תאריך פעילות אחרון', format: 'formatDate' },
]

export function isDatePassed(_, obj) {
  const today = new Date().setHours(0, 0, 0, 0)
  const dueDate = new Date(obj.dueDate).setHours(0, 0, 0, 0)
  const isOver = dueDate < today && !obj.completed
  return <div className={`${isOver ? 'text-red-500' : ''}`}> {formatDate(obj.dueDate)}</div>
}

function formatTitle(_, obj) {
  return (
    <Link href={`/clients/${obj.clientId}/tasks/${obj.id}`} className='underline underline-offset-2 font-semibold'>
      {obj.title}
    </Link>
  )
}
