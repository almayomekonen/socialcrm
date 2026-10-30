'use client'

import { useMemo, useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import ExportTable from '@/lib/table/export'
import Table, { ConfigT } from '@/lib/table'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { taskDueDateCell } from './ClientTasksTable'
import SelectTasksStatus from './SelectTasksStatus'
import { getFormData2 } from '@/lib/form/funcs'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { saveTblPref } from '@/actions/global'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { taskStatusLabel } from '@/lib/tasks/taskStatus'

/**
 * The global /tasks table; chrome follows the interface language. Task titles,
 * lead and rep names are data. Statuses are STORED Hebrew values: filters and
 * the URL keep them, only the cell text is labelled. The column state (and
 * `user.tblPref`, and the export) keeps the stored Hebrew labels.
 */
export default function TasksTable({ data, users, filter, user, fillHeight = false }) {
  const t = useT()
  const locale = t.locale
  const safeData = Array.isArray(data) ? data : []
  const [state, setState] = useState<any[]>(safeData)
  const tblId = 'tasksTable435'
  const [storedColumns, setStoredColumns] = useState(user?.tblPref?.[tblId] || headers)
  const localized = useLocalizedColumns(storedColumns, setStoredColumns, (next) => saveTblPref(tblId, next), taskColumnLabel)
  // Outside Hebrew the status cell is labelled (Hebrew shows the stored value, as before).
  const columns = useMemo(
    () =>
      locale === 'he'
        ? localized.columns
        : localized.columns.map((c) => (c.key === 'status' && !c.format ? { ...c, format: 'formatTaskStatus' } : c)),
    [localized.columns, locale],
  )

  const config = {
    tblId,
    columns,
    setColumns: localized.setColumns,
    data: safeData,
    state,
    setState,
    funcs: {
      formatTitle,
      isDatePassed: (_, obj) => taskDueDateCell(obj, locale),
      ...(locale === 'he'
        ? {}
        : {
            formatDate: (value) => (value ? formatLeadDate(locale, value) : ''),
            formatTaskStatus: (value) => taskStatusLabel(value, locale),
          }),
    },
    getColumns(columns) {
      localized.save(columns as unknown as Parameters<typeof localized.save>[0])
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
  // Counts as their digits (no grouping), exactly as Hebrew printed them.
  const n = (count: number) => ({ count: String(count) })

  return (
    <>
      <div className={fillHeight ? 'flex flex-col min-h-0 flex-1' : 'grid'}>
        <div className={`flex items-end justify-between mb-2 ${fillHeight ? 'shrink-0' : ''}`}>
          <div className='flex gap-2 items-end'>
            <Search config={config} />
            <ShowColumns config={config} />
            <Select options={[]} val='func' placeholder={t('tasks.page.actions')} />

            <form onSubmit={onFilter} className='flex items-end gap-2'>
              <SelectTasksStatus defaultValue={filter.status} translated />
              <SelectSearch lbl={t('tasks.page.reps')} name='userId' options={users} selected={filter.userId} className='w-52' />
              <div className='flex gap-0'>
                <Btn className='rounded-e-none gap-4 px-6' type='submit' lbl={t('tasks.page.filter')} variant='outline' />
                <Btn variant='outline' size='icon' icon='eraser' aria-label={t('tasks.page.clearFilter')} href='?' scroll={false} className='rounded-s-none border-s-0' />
              </div>
            </form>
          </div>

          <div className='flex items-center gap-2'>
            <ExportTable data={state} columns={storedColumns} />
            <Btn lbl={t('tasks.page.create')} icon='plus' popoverTarget='chooseTaskTmplt' />
          </div>
        </div>

        <Table config={config} tblCls={fillHeight && (state?.length ?? 0) > 0 ? 'mb-0 rounded-b-none tbl-fill' : 'mb-0 rounded-b-none'} />
        {(state?.length ?? 0) === 0 && (
          <div className={`flex items-center justify-center text-gray-400 ${fillHeight ? 'flex-1' : 'h-48'}`}>{t('tasks.page.empty')}</div>
        )}
        {fillHeight && taskCount > 0 && (
          <div className='shrink-0 flex items-center justify-between p-4 bg-white border border-t-0 rounded-b-md w-full text-sm'>
            <p className='font-medium'>{t('tasks.page.count', n(taskCount))}</p>
            <div className='flex items-center gap-4 text-gray-500'>
              <span>{t('tasks.page.active', n(activeCount))}</span>
              <span>{t('tasks.page.done', n(completedCount))}</span>
              {overdueCount > 0 && <span className='font-medium text-red-600'>{t('tasks.page.overdue', n(overdueCount))}</span>}
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

/** Header text by column KEY (the stored `label` is what Hebrew shows). */
const TASK_HEADER_KEY: Record<string, MessageKey> = {
  title: 'tasks.page.header.title',
  status: 'tasks.page.header.status',
  clientName: 'tasks.page.header.clientName',
  completed: 'tasks.page.header.completed',
  userName: 'tasks.page.header.userName',
  dueDate: 'tasks.page.header.dueDate',
  createdAt: 'tasks.page.header.createdAt',
  updatedAt: 'tasks.page.header.updatedAt',
}

function taskColumnLabel(key: string, locale: UiLocale): string | null {
  const k = TASK_HEADER_KEY[key]
  return k ? translatorFor(locale)(k) : null
}

function formatTitle(_, obj) {
  return (
    <Link href={`/clients/${obj.clientId}/tasks/${obj.id}`} className='font-semibold underline underline-offset-2'>
      {obj.title}
    </Link>
  )
}
