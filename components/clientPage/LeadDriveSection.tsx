'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { attachDriveFile, detachDriveFile, type LeadDriveAttachment } from '@/actions/leadDriveFiles'
import type { SuggestedDriveFile } from '@/actions/leadDriveFilesSearch'
import LeadDriveAttachModal from './LeadDriveAttachModal'
import LeadDriveAttachedRow from './LeadDriveAttachedRow'
import LeadDriveSuggestionRow from './LeadDriveSuggestionRow'

type Props = {
  leadId: number
  attachments: LeadDriveAttachment[]
  suggestions: SuggestedDriveFile[]
}

export default function LeadDriveSection({ leadId, attachments, suggestions }: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function handleAttachSuggested(file: SuggestedDriveFile) {
    if (busyId) return
    setBusyId(file.driveFileId)
    try {
      const res = await attachDriveFile({
        leadId,
        driveFileId: file.driveFileId,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
      })
      if (res.ok) {
        toast('success', 'הקובץ צורף לליד')
        refresh()
      } else {
        toast('error', 'הצירוף נכשל. נסה שוב.')
      }
    } catch {
      toast('error', 'הצירוף נכשל. נסה שוב.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDetach(att: LeadDriveAttachment) {
    if (busyId) return
    setBusyId(`a-${att.id}`)
    try {
      const res = await detachDriveFile(att.id)
      if (res.ok) {
        toast('success', 'הקובץ הוסר')
        refresh()
      } else {
        toast('error', 'ההסרה נכשלה. נסה שוב.')
      }
    } catch {
      toast('error', 'ההסרה נכשלה. נסה שוב.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className='rounded-2xl border border-gray-100 bg-white p-4'>
      <header className='flex items-center justify-between gap-3 mb-3'>
        <div className='flex items-center gap-2'>
          <Icon name='google-drive' className='size-5 bg-gray-900' />
          <h2 className='text-base font-bold text-dark'>Google Drive</h2>
        </div>
        <Btn lbl='צרף קובץ מ-Drive' size='small' onClick={() => setModalOpen(true)} />
      </header>

      {attachments.length > 0 && (
        <div className='grid gap-1.5 mb-4'>
          {attachments.map((att) => (
            <LeadDriveAttachedRow
              key={att.id}
              attachment={att}
              busy={busyId === `a-${att.id}` || pending}
              onDetach={() => handleDetach(att)}
            />
          ))}
        </div>
      )}

      {attachments.length === 0 && (
        <p className='text-sm text-gray-500 mb-4'>אין קבצים מצורפים לליד מ-Drive.</p>
      )}

      {suggestions.length > 0 && (
        <div className='grid gap-1.5'>
          <p className='text-[11px] text-gray-400 tracking-wide'>מוצע — נמצאו ב-Drive לפי פרטי הליד</p>
          {suggestions.map((s) => (
            <LeadDriveSuggestionRow
              key={s.driveFileId}
              file={s}
              busy={busyId === s.driveFileId || pending}
              onAttach={() => handleAttachSuggested(s)}
            />
          ))}
        </div>
      )}

      <LeadDriveAttachModal open={modalOpen} leadId={leadId} onClose={() => setModalOpen(false)} onAttached={refresh} />
    </section>
  )
}
