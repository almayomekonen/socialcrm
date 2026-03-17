'use client'

import { useState } from 'react'
import FileUploader from '../files/FileUploader'

export default function TaskFiles({ task }) {
  const [files, setFiles] = useState(task.files || [])
  const isTmplt = !task.clientId

  const handleFilesChange = (updatedFileList) => {
    task.files = updatedFileList
  }

  const folder = isTmplt ? `taskTmplts` : `${task.clientId}/${task.id}`

  return (
    <div className='mt-2' style={{ gridArea: 'files' }}>
      <FileUploader
        title='מסמכים קשורים'
        clientId={task.clientId}
        taskId={isTmplt ? null : task.id}
        initialFiles={files}
        path={folder}
        onFilesChange={handleFilesChange}
      />
    </div>
  )
}
