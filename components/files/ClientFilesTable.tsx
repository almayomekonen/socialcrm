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

export default function ClientFilesTable({ clientId, data, tasks }) {
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(headers)

  async function onDel(file) {
    if (!confirm(`האם למחוק מסמך ${file?.name} ?`)) return

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
        <th className='sticky left-0 z-10 bg-gray-100'>מחיקה</th>
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
    },
  } as ConfigT

  return (
    <>
      <div className='grid py-4'>
        <div className='flex justify-between gap-2'>
          <div className='flex gap-2 items-end mb-2 mobile:gap-2'>
            <Search config={config} />
            {/* <ShowColumns config={config} /> */}
            <Select
              options={['word', 'excel', 'powerpoint', 'pdf', 'image', 'other']}
              placeholder='סוג קובץ'
              onChange={(e) => onFilterChange(e, 'type')}
            />
            <Select options={fileSizes} placeholder='גודל' onChange={onSizeChange} />
          </div>
          <div className='flex gap-4 items-end mb-2'>
            <ExportTable data={state} columns={columns} />
            <Btn lbl='העלה קבצים' icon='file-arrow-up' popoverTarget='filePopover' />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' key={Math.random()} />
      </div>

      <FileForm clientId={clientId} tasks={tasks} />
    </>
  )
}

function formatFileSize(mb) {
  return toMB(mb) + 'MB'
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
