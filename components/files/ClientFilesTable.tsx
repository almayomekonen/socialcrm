'use client'

import { useState } from 'react'
import Table, { ConfigT } from '@/lib/table'
import Search from '@/lib/table/Search'
import ExportTable from '@/lib/table/export'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import Link from 'next/link'
import FileForm from './FileForm'
import { formatIconFile, getFileType } from './funcs'
import { toMB } from '@/lib/funcs'
import { deleteFile } from '../../actions/files'
import { api } from '@/lib/funcs'
import { fileSizes } from '@/types/vars'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import type { LeadColumn } from '@/components/clients/table/headers'
import { formatLeadDate } from '@/lib/leads/leadDate'

/**
 * The lead files tab table; chrome follows the interface language. File names,
 * task titles and uploader names are data. The export receives the STORED
 * (Hebrew) column labels, as every table export does.
 */
export default function ClientFilesTable({ clientId, data, tasks }) {
  const t = useT()
  const locale = t.locale
  const [state, setState] = useState(data)
  const [storedColumns, setStoredColumns] = useState<LeadColumn[]>(headers)
  const { columns, setColumns } = useLocalizedColumns(storedColumns, setStoredColumns, () => {}, fileColumnLabel)
  const [fileToDelete, setFileToDelete] = useState<any>(null)

  function onDel(file) {
    setFileToDelete(file)
  }

  async function performDelete() {
    const file = fileToDelete
    setFileToDelete(null)
    if (!file) return
    await api(deleteFile, [file])
  }

  function onFilterChange(e, filter) {
    const type = e.target.value
    if (!type) return setState(data)

    setState(
      data.filter((d) => {
        return type === getFileType(d.type)
      })
    )
  }

  function onSizeChange(e) {
    const size = e.target.value
    if (!size) {
      setState(data)
    } else {
      const tmp = data.filter((d) => Number(d.size) <= size)
      setState([...tmp])
    }
  }

  function moreRows(file) {
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          <Btn variant='outline' icon='trash' onClick={() => onDel(file)} />
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
        <Link href={`/clients/${clientId}/tasks/${obj.taskId}`} className='underline underline-offset-2 font-semibold'>
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
      formatDate: (value) => (value ? formatLeadDate(locale, value) : ''),
    },
  } as ConfigT

  return (
    <>
      <div className='grid py-4'>
        <h2 className='text-xl font-semibold mb-3'>{t('leadTabs.files.title')}</h2>
        <div className='flex justify-between gap-2'>
          <div className='flex gap-2 items-end mb-2 mobile:gap-2'>
            <Search config={config} />
            {/* <ShowColumns config={config} /> */}
            <Select
              options={['word', 'excel', 'powerpoint', 'pdf', 'image', 'other']}
              placeholder={t('leadTabs.files.typeFilter')}
              onChange={(e) => onFilterChange(e, 'type')}
            />
            <Select options={sizeOptions(locale)} placeholder={t('leadTabs.files.sizeFilter')} onChange={onSizeChange} />
          </div>
          <div className='flex gap-4 items-end mb-2'>
            <ExportTable data={state} columns={storedColumns} />
            <Btn lbl={t('leadTabs.files.upload')} icon='file-arrow-up' popoverTarget='filePopover' />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' key={Math.random()} />
      </div>

      <FileForm clientId={clientId} tasks={tasks} />
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

/** Size filter options: the stored byte limits, labelled in the interface language (Hebrew: `fileSizes` itself). */
function sizeOptions(locale: UiLocale) {
  if (locale === 'he') return fileSizes
  const t = translatorFor(locale)
  return fileSizes.map((s) => ({ ...s, name: t('leadTabs.files.sizeUpTo', { size: `${s.id / 1024 / 1024}MB` }) }))
}

/** Header text by column KEY (the stored `label` is what Hebrew shows). */
const FILE_HEADER_KEY: Record<string, MessageKey> = {
  type: 'leadTabs.files.header.type',
  name: 'leadTabs.files.header.name',
  taskId: 'leadTabs.files.header.taskId',
  createdAt: 'leadTabs.files.header.createdAt',
  size: 'leadTabs.files.header.size',
  createdByName: 'leadTabs.files.header.createdByName',
}

function fileColumnLabel(key: string, locale: UiLocale): string | null {
  const k = FILE_HEADER_KEY[key]
  return k ? translatorFor(locale)(k) : null
}

export const headers = [
  { key: 'type', label: 'סוג קובץ', format: 'formatFileType' },
  { key: 'name', label: 'שם המסמך', format: 'formatFileName' },
  { key: 'taskId', label: 'מעקב', format: 'formatTask' },
  { key: 'createdAt', label: 'מועד יצירה', format: 'formatDate' },
  { key: 'size', label: 'גודל ', format: 'formatFileSize' },
  { key: 'createdByName', label: 'הועלה ע"י' },
]

function formatFileName(_, obj) {
  return (
    <a href={obj.url} target='_blank' rel='noopener noreferrer' className='underline underline-offset-2 font-semibold'>
      {obj.name}
    </a>
  )
}
