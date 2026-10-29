'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import { Select } from '@/lib/form'
import { formatDate } from '@/lib/dates'
import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'
import { translatorFor } from '@/lib/i18n/translators'
import SelectTasksStatus from './SelectTasksStatus'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { taskStatusLabel } from '@/lib/tasks/taskStatus'

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
  const t = useT()
  const locale = t.locale
  const safeData = Array.isArray(data) ? data : []

  const tblId = 'clientTasksTable12'
  const [state, setState] = useState<any[]>([...safeData])

  const [storedColumns, setStoredColumns] = useState(tblPref?.[tblId] || saleTableHeaders)
  // Headers by column KEY in the interface language; the column state keeps its labels (Hebrew: unchanged).
  const { columns, setColumns } = useLocalizedColumns(storedColumns, setStoredColumns, () => {}, taskColumnLabel)

  // Filter by the STORED status value (the picker sends the value, never its label).
  const handleStatusFilter = (status) => {
    selectedStatus = status
    if (!status) {
      // Show all data when no status is selected or default option is selected
      setState([...safeData])
    } else {
      // Filter data based on selected status
      const filteredData = safeData.filter((item) => item.status === status)
      setState(filteredData)
    }
  }

  const handleUserFilter = (e) => {
    selectedUser = e.target.value
    // The placeholder option's value is ''; options are handler names (data).
    if (!selectedUser) {
      setState([...safeData])
    } else {
      const filteredData = safeData.filter((item) => item.userName === selectedUser)
      setState(filteredData)
    }
  }

  const config = {
    columns,
    setColumns,
    data: safeData,
    state,
    setState,
    funcs: {
      isDatePassed: (_, obj) => dueDateCell(obj, locale),
      formatTitle,
      formatDate: (value) => (value ? formatLeadDate(locale, value) : ''),
      formatTaskStatus: (value) => taskStatusLabel(value, locale),
    },
  } as ConfigT

  return (
    <div className='my-8'>
      <div className='flex justify-between gap-4'>
        <div className='flex gap-3 items-end mb-2'>
          {/* <Search config={config} /> */}
          {/* <ShowColumns config={config} /> */}
          {/* <Btn variant='outline' lbl='סינון' popoverTarget='filterPop' icon='filter' /> */}
          <SelectTasksStatus defaultValue={selectedStatus} onChange={handleStatusFilter} translated />
          <Select
            placeholder={t('leadTabs.tasks.table.handlerFilter')}
            options={users}
            defaultValue={selectedUser}
            onChange={handleUserFilter}
            className='w-52'
          />
        </div>

        <div className='flex gap-4 items-end mb-2'>
          {/* <Btn variant='outline' lbl='איפוס סינון' icon='eraser' href='?' className='gap-4' /> */}
          {/* <FilterBtn /> */}
          <Btn lbl={t('leadTabs.tasks.table.create')} icon='plus' popoverTarget='chooseTaskTmplt' /> 
          {/* <Btn lbl='הוספת משימה' popoverTarget='popSaleForm' icon='plus' /> */}
        </div>
      </div>

      <Table config={config} tblCls='mb-0 rounded-b-none' />
      {/* <SalesTableFooter props={props} /> */}
    </div>
  )
}

const saleTableHeaders = [
  { key: 'title', label: 'כותרת', format: 'formatTitle' },
  { key: 'status', label: 'סטטוס', format: 'formatTaskStatus' },
  { key: 'userName', label: 'גורם מטפל' },
  { key: 'completed', label: 'הושלם' },
  { key: 'dueDate', label: 'תאריך יעד', format: 'isDatePassed' },
  { key: 'createdAt', label: 'תאריך יצירה', format: 'formatDate' },
  { key: 'updatedAt', label: 'תאריך פעילות אחרון', format: 'formatDate' },
]

/** Header text by column KEY (the stored `label` is what Hebrew shows). */
const TASK_HEADER_KEY: Record<string, MessageKey> = {
  title: 'leadTabs.tasks.table.header.title',
  status: 'leadTabs.tasks.table.header.status',
  userName: 'leadTabs.tasks.table.header.userName',
  completed: 'leadTabs.tasks.table.header.completed',
  dueDate: 'leadTabs.tasks.table.header.dueDate',
  createdAt: 'leadTabs.tasks.table.header.createdAt',
  updatedAt: 'leadTabs.tasks.table.header.updatedAt',
}

function taskColumnLabel(key: string, locale: UiLocale): string | null {
  const k = TASK_HEADER_KEY[key]
  return k ? translatorFor(locale)(k) : null
}

/** Shared with the global /tasks table, which is not translated yet (Hebrew dates). */
export function isDatePassed(_, obj) {
  return dueDateCell(obj, 'he')
}

function dueDateCell(obj, locale: UiLocale) {
  const today = new Date().setHours(0, 0, 0, 0)
  const dueDate = new Date(obj.dueDate).setHours(0, 0, 0, 0)
  const isOver = dueDate < today && !obj.completed
  return <div className={`${isOver ? 'text-red-500' : ''}`}> {locale === 'he' ? formatDate(obj.dueDate) : obj.dueDate ? formatLeadDate(locale, obj.dueDate) : ''}</div>
}

function formatTitle(_, obj) {
  return (
    <Link href={`/clients/${obj.clientId}/tasks/${obj.id}`} className='underline underline-offset-2 font-semibold'>
      {obj.title}
    </Link>
  )
}
