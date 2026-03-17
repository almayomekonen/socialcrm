'use client'

import { useState } from 'react'
import Icon, { IconNames } from '@/lib/Icon'
import { FileDisplay, uploadS3 } from './funcs'
import { useUser } from '@/lib/hooksNEvents'
import dynamic from 'next/dynamic'
import { twMerge } from 'tailwind-merge'

const Glry = dynamic(() => import('./Glry'), { ssr: false })
type folderPath = 'display' | 'docs'

export default function FileUploader({
  title = 'העלאת קבצים',
  initialFiles,
  folder = 'docs',
  path,
  onFilesChange = () => {},
  getFiles = () => {},
  className = '',
  name = 'files',
  type = 'file',
  single = false,
  icon,
  tooltipClass = '',
  disabled = false,
  taskId = null,
  clientId = null,
}: Props) {
  const [files, setFiles] = useState(single && initialFiles ? [initialFiles] : initialFiles || [])
  const user = useUser()

  async function onRemove(fileToRemove) {
    if (!confirm(`להסיר את הקובץ?`)) return

    const updatedFiles = files.filter((file) => file.id !== fileToRemove.id)

    setFiles(updatedFiles)
    onFilesChange(updatedFiles)
  }

  const folderPath = path || `${user.id}/${folder}`

  async function onFilesSelected(e: any) {
    getFiles(e.target.files)

    const newFiles = (await uploadS3(e, folderPath, taskId, clientId)) as any
    if (newFiles.err) return alert('העלאת הקבצים נכשלה: ' + newFiles.msg)

    const obj = single ? [newFiles[0]] : [...files, ...newFiles]
    setFiles(obj)
    onFilesChange(obj)
  }

  function onGlrySelect(img) {
    const updatedFiles = single ? [img] : [...files, img]
    setFiles(updatedFiles)
    onFilesChange(updatedFiles)
  }
  return (
    <div className={className}>
      {files.length > 0 && <FileDisplay tooltipClass={tooltipClass} files={files} onRemove={onRemove} />}

      <div className='grid gap-2'>
        {type === 'image' && <Glry onSelect={onGlrySelect} />}

        <label className={twMerge('btn', disabled && 'opacity-50')}>
          <Icon name={icon ? icon : type === 'image' ? 'image' : 'file-lines'} className='size-4' />
          <p>{title}</p>

          <input
            disabled={disabled}
            type='file'
            multiple={!single}
            accept={type === 'image' ? 'image/*' : undefined}
            onChange={onFilesSelected}
            className='hidden'
          />
        </label>
        <input
          name={name}
          defaultValue={single ? JSON.stringify(files?.[0]?.id || null) : JSON.stringify(files.map((f) => f.id))}
          type='hidden'
        />
      </div>
    </div>
  )
}

type Props = {
  title?: string
  initialFiles?: any[] | any
  folder?: folderPath
  path?: string
  onFilesChange?: (files: any[]) => void
  getFiles?: (files: any[]) => void
  className?: string
  name?: string
  type?: 'file' | 'image'
  single?: boolean
  icon?: IconNames
  tooltipClass?: string
  disabled?: boolean
  taskId?: number | null
  clientId?: number | null
}
