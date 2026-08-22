'use client'

import { useState } from 'react'
import Icon, { IconNames } from '@/lib/Icon'
import { FileDisplay, uploadS3 } from './funcs'
import { useUser } from '@/lib/hooksNEvents'
import dynamic from 'next/dynamic'
import { twMerge } from 'tailwind-merge'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'

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
  const [fileToRemove, setFileToRemove] = useState<any>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const user = useUser()
  /**
   * PRE-GATE at the single choke point. Every upload path runs through
   * `uploadS3` → `getPresigned`/`addFiles`, both requireProductAccess-guarded,
   * and `uploadS3` catches the refusal into
   * "העלאת הקבצים נכשלה: …" — a lapsed subscription reported as a failed
   * upload. Gating here covers the lead files tab, task files, the Excel lead
   * import and the issuer logo in one place. Already-uploaded files stay
   * listed and downloadable by their own components.
   */
  const expired = useAccessDenied()

  if (!user) return null
  if (expired) {
    return <SubscriptionExpiredState mode='inline' source='file_upload' feature='חידוש המנוי מחזיר את העלאת הקבצים' />
  }

  function onRemove(file) {
    setFileToRemove(file)
  }

  function performRemove() {
    const target = fileToRemove
    setFileToRemove(null)
    if (!target) return
    const updatedFiles = files.filter((file) => file.id !== target.id)
    setFiles(updatedFiles)
    onFilesChange(updatedFiles)
  }

  const folderPath = path || `${user.id}/${folder}`

  async function onFilesSelected(e: any) {
    getFiles(e.target.files)

    const newFiles = (await uploadS3(e, folderPath, taskId, clientId)) as any
    if (newFiles.err) return setErrMsg('העלאת הקבצים נכשלה: ' + newFiles.msg)

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
      <ConfirmPop
        open={!!fileToRemove}
        destructive
        onClose={() => setFileToRemove(null)}
        onConfirm={performRemove}
        msg='להסיר את הקובץ?'
      />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
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
