'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ExportTable from '@/lib/table/export'
import { Btn } from '@/lib/btns/Btn'
import Link from 'next/link'
import { formatIconFile, getFileType } from './funcs'
import { toMB } from '@/lib/funcs'
import { deleteFile } from '../../actions/files'
import { Select } from '@/lib/form'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { UiLocale } from '@/lib/i18n/config'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import type { LeadColumn } from '@/components/clients/table/headers'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { fileColumnLabel, sizeOptions } from './ClientFilesTable'

/**
 * The global /files table; chrome follows the interface language. File, lead
 * and task names and uploader names are data. Headers are displayed by column
 * KEY; the column state and the export keep the stored Hebrew labels.
 */
export default function FilesTable({ data, tasks, clients, fillHeight = false }) {
  const t = useT()
  const locale = t.locale
  const [state, setState] = useState(data)
  const [storedColumns, setStoredColumns] = useState<LeadColumn[]>(headers)
  const { columns, setColumns } = useLocalizedColumns(storedColumns, setStoredColumns, () => {}, globalFileColumnLabel)
  const [fileToDelete, setFileToDelete] = useState<any>(null)

  function onDel(file) {
    setFileToDelete(file)
  }

  async function performDelete() {
    const file = fileToDelete
    setFileToDelete(null)
    if (!file) return
    await deleteFile(file)
  }

  function onFilterChange(e, filter) {
    const type = e.target.value
    if (!type) return setState(data)

    setState(
      state.filter((d) => {
        return type === getFileType(d.type)
      })
    )
  }

  function onSizeChange(e) {
    const size = e.target.value
    if (!size) {
      setState(data)
    } else {
      const tmp = state.filter((d) => Number(d.size) <= size)
      setState([...tmp])
    }
  }

  function onClientChange(e) {
    const clientId = e.target.value
    clientId ? setState(state.filter((d) => d.clientId == clientId)) : setState(data)
  }

  function moreRows(file) {
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          {/* Icon-only: named outside Hebrew (Phase E6); Hebrew markup is unchanged. */}
          <Btn
            variant='outline'
            icon='trash'
            onClick={() => onDel(file)}
            {...(t.locale === 'he' ? {} : { 'aria-label': t('leadTabs.files.deleteButton', { name: String(file.name) }) })}
          />
        </td>
      </>
    )
  }

  function moreHeads() {
    return (
      <>
        <th className='sticky left-0 z-10 bg-gray-100'>{t('leadTabs.files.deleteColumn')}</th>
      </>
    )
  }

  function formatTask(_, obj) {
    return (
      <>
        <Link href={`/clients/${obj.clientId}/tasks/${obj.taskId}`} className='underline underline-offset-2 font-semibold'>
          {obj.taskTitle}
        </Link>
      </>
    )
  }

  const config = {
    columns,
    setColumns,
    data,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: {
      formatFileType: formatIconFile,
      formatFileSize,
      formatTask,
      formatFileName,
      formatClientName,
      ...(locale === 'he' ? {} : { formatDate: (value) => (value ? formatLeadDate(locale, value) : '') }),
    },
  } as ConfigT

  return (
    <>
      <h1 className={`title my-6 ${fillHeight ? 'shrink-0' : ''}`}>{t('tasks.files.title')}</h1>

      <div className={fillHeight ? 'flex flex-col min-h-0 flex-1' : 'grid'}>
        <div className={`flex justify-between ${fillHeight ? 'shrink-0' : ''}`}>
          <div className='flex gap-2 items-end mb-2 mobile:gap-2'>
            <Search config={config} />
            {/* <ShowColumns config={config} /> */}
            <Select
              options={['word', 'excel', 'powerpoint', 'pdf', 'image', 'other']}
              placeholder={t('leadTabs.files.typeFilter')}
              onChange={(e) => onFilterChange(e, 'type')}
            />
            <Select options={sizeOptions(locale)} placeholder={t('leadTabs.files.sizeFilter')} onChange={onSizeChange} />
            <Select id='clients' options={clients} placeholder={t('tasks.files.leadFilter')} onChange={onClientChange} />
          </div>

          <div className='flex justify-between gap-2'>
            <div className='flex gap-4 items-end mb-2'>
              <ExportTable data={state} columns={storedColumns} />
              {/* <Btn lbl='העלה קבצים' icon='file-arrow-up' popoverTarget='filePopover' /> */}
            </div>
          </div>
        </div>

        <Table config={config} tblCls={fillHeight ? 'mb-0 rounded-b-none tbl-fill' : 'mb-0 rounded-b-none'} key={Math.random()} />
        {state.length === 0 && (
          <div className={`flex items-center justify-center h-48 text-gray-400 ${fillHeight ? 'shrink-0' : ''}`}>{t('tasks.files.empty')}</div>
        )}
      </div>

      {/* <FileForm clientId={clientId} tasks={tasks} /> */}
      <ConfirmPop
        open={!!fileToDelete}
        destructive
        onClose={() => setFileToDelete(null)}
        onConfirm={performDelete}
        msg={t('leadTabs.files.deleteConfirm', { name: String(fileToDelete?.name) })}
        translated
      />
    </>
  )
}

function formatFileSize(mb) {
  return toMB(mb) + 'MB'
}

export const headers = [
  { key: 'type', label: 'סוג קובץ', format: 'formatFileType' },
  { key: 'name', label: 'שם המסמך', format: 'formatFileName' },
  { key: 'clientName', label: 'ליד', format: 'formatClientName' },
  { key: 'taskId', label: 'מעקב', format: 'formatTask' },
  { key: 'createdAt', label: 'מועד יצירה', format: 'formatDate' },
  { key: 'size', label: 'גודל ', format: 'formatFileSize' },
  { key: 'createdByName', label: 'הועלה ע"י' },
]

/** Header text by column KEY: the lead tab's, plus this table's lead column. */
function globalFileColumnLabel(key: string, locale: UiLocale): string | null {
  return key === 'clientName' ? translatorFor(locale)('tasks.files.clientNameHeader') : fileColumnLabel(key, locale)
}

function formatFileName(_, obj) {
  return (
    <a href={obj.url} target='_blank' rel='noopener noreferrer' className='underline underline-offset-2 font-semibold'>
      {obj.name}
    </a>
  )
}
function formatClientName(_, obj) {
  return (
    <Link href={`/clients/${obj.clientId}/tasks`} className='underline underline-offset-2 font-semibold'>
      {obj.clientName}
    </Link>
  )
}
