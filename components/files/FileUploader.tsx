'use client'

import { useState } from 'react'
import Icon, { IconNames } from '@/lib/Icon'
import { FileDisplay, UPLOAD_NONE_SELECTED, UPLOAD_TOO_LARGE, uploadToStorage } from './funcs'
import { useUser } from '@/lib/hooksNEvents'
import dynamic from 'next/dynamic'
import { twMerge } from 'tailwind-merge'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

const HEBREW = translatorFor('he')

/** `uploadToStorage`'s own refusals by their exact sentence (Hebrew = the same sentence); any other reason is shown as received. */
const REASON_KEY: Record<string, MessageKey> = {
  [UPLOAD_TOO_LARGE]: 'leadTabs.files.uploader.tooLarge',
  [UPLOAD_NONE_SELECTED]: 'leadTabs.files.uploader.noneSelected',
}

const Glry = dynamic(() => import('./Glry'), { ssr: false })

export default function FileUploader({
  title,
  initialFiles,
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
  translated = false,
}: Props) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const [files, setFiles] = useState(single && initialFiles ? [initialFiles] : initialFiles || [])
  const [fileToRemove, setFileToRemove] = useState<any>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const user = useUser()
  /**
   * PRE-GATE at the single choke point. Every upload path runs through
   * `uploadToStorage` → `getPresigned`/`addFiles`, both requireProductAccess-guarded,
   * and `uploadToStorage` catches the refusal into
   * "העלאת הקבצים נכשלה: …" — a lapsed subscription reported as a failed
   * upload. Gating here covers the lead files tab, task files, the Excel lead
   * import and the issuer logo in one place. Already-uploaded files stay
   * listed and downloadable by their own components.
   */
  const expired = useAccessDenied()

  if (!user) return null
  if (expired) {
    return (
      <SubscriptionExpiredState
        mode='inline'
        source='file_upload'
        feature={t('leadTabs.files.uploader.expired')}
        translated={translated}
      />
    )
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

  async function onFilesSelected(e: any) {
    getFiles(e.target.files)

    const newFiles = (await uploadToStorage(e, taskId, clientId)) as any
    // The reason: the upload's own refusals worded by sentence; any other error text is shown as it arrives.
    if (newFiles.err) {
      const key = REASON_KEY[newFiles.msg]
      return setErrMsg(t('leadTabs.files.uploader.failed', { reason: key ? t(key) : newFiles.msg }))
    }

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
      {files.length > 0 && <FileDisplay tooltipClass={tooltipClass} files={files} onRemove={onRemove} unavailableLabel={t('leadTabs.files.uploader.unavailable')} />}

      <div className='grid gap-2'>
        {type === 'image' && <Glry onSelect={onGlrySelect} label={t('leadTabs.files.uploader.gallery')} />}

        <label className={twMerge('btn', disabled && 'opacity-50')}>
          <Icon name={icon ? icon : type === 'image' ? 'image' : 'file-lines'} className='size-4' />
          <p>{title ?? t('leadTabs.files.uploader.title')}</p>

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
        msg={t('leadTabs.files.uploader.removeConfirm')}
        translated={translated}
      />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated={translated}
      />
    </div>
  )
}

type Props = {
  title?: string
  initialFiles?: any[] | any
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
  /**
   * The caller's screen follows the interface language (the lead files tab,
   * table export): the uploader's own chrome (default title, confirmations,
   * failure line, lock) follows it too. Off: Hebrew, as before.
   */
  translated?: boolean
}
