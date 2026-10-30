'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useT } from '@/lib/i18n/I18nProvider'

const FileUploader = dynamic(() => import('../files/FileUploader'), { ssr: false })

/** Only the task-template editor (settings) renders this; it follows the interface language. */
export default function TaskFiles({ task }) {
  const t = useT()
  const [files, setFiles] = useState(task.files || [])
  const isTmplt = !task.clientId

  const handleFilesChange = (updatedFileList) => {
    task.files = updatedFileList
  }

  const folder = isTmplt ? `taskTmplts` : `${task.clientId}/${task.id}`

  return (
    <div className='mt-2' style={{ gridArea: 'files' }}>
      <FileUploader
        title={t('admin.taskTmplts.files')}
        translated
        clientId={task.clientId}
        taskId={isTmplt ? null : task.id}
        initialFiles={files}
        path={folder}
        onFilesChange={handleFilesChange}
      />
    </div>
  )
}
