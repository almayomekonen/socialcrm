'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Link from 'next/link'
import Search from '@/lib/table/Search'
import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { addTaskTmplt, deleteTaskTmplt } from '@/actions/tasks'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { taskTmpltColumnLabel } from '@/components/agntsAndGrps/adminLabels'

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
  const [selected, setSelected] = useState<any>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const t = useT()
  const locale = t.locale
  const [storedColumns, setStoredColumns] = useState(tblPref?.[tblId] || saleTableHeaders)
  // Headers by column KEY in the interface language; the stored columns keep their Hebrew labels.
  const { columns, setColumns } = useLocalizedColumns(storedColumns, setStoredColumns, () => {}, taskTmpltColumnLabel)

  function onCheckboxChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.name !== 'checkRow') return
    const id = Number(e.target.id)
    setSelected(e.target.checked ? state.find((t) => t.id === id) ?? null : null)
  }

  function onDelete() {
    if (!selected) return
    setConfirmDelete(true)
  }

  async function performDelete() {
    const target = selected
    setConfirmDelete(false)
    if (!target) return
    setState((prev) => prev.filter((t) => t.id !== target.id))
    setSelected(null)
    await deleteTaskTmplt(target)
  }

  const config = {
    columns,
    setColumns,
    data,
    state,
    setState,
    funcs: {
      formatTitle,
      // Outside Hebrew dates use the business time zone; Hebrew keeps the table's own formatter.
      ...(locale === 'he' ? {} : { formatDate: (value) => (value ? formatLeadDate(locale, value) : '') }),
    },
  } as ConfigT

  return (
    <div className='mb-8'>
      <div className='flex justify-between gap-4'>
        <div className='flex gap-3 items-end mb-2'>
          <Search config={config} />
          {selected && (
            <Btn lbl={t('admin.taskTmplts.delete')} icon='trash' variant='outline' onClick={onDelete} className='text-red-500 border-red-300 hover:bg-red-50' />
          )}
        </div>
        <div className='flex gap-4 items-end mb-2'>
          <AddTaskTmpltBtn />
        </div>
      </div>

      <div onChange={onCheckboxChange as any}>
        <Table config={config} tblCls='mb-0 rounded-b-none' />
      </div>

      <ConfirmPop
        open={confirmDelete}
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={performDelete}
        msg={t('admin.taskTmplts.deleteConfirm', { title: String(selected?.title) })}
        translated
      />
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
  const t = useT()
  async function addAndRedirect() {
    const id = await addTaskTmplt()
    redirect(`/settings/edit_tmplts/${id}`)
  }

  return <Btn lbl={t('admin.taskTmplts.create')} icon='plus' onClick={addAndRedirect} />
}
