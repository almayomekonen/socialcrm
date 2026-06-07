'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import { toast } from '@/lib/toast'
import { iconForDriveMime } from '@/lib/copilot/driveMimeIcon'
import { attachDriveFile } from '@/actions/leadDriveFiles'
import { searchDriveForLead, type SuggestedDriveFile } from '@/actions/leadDriveFilesSearch'

type Props = {
  open: boolean
  onClose: () => void
  leadId: number
  onAttached?: () => void
}

export default function LeadDriveAttachModal({ open, onClose, leadId, onAttached }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SuggestedDriveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [attachingId, setAttachingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state each time the modal opens so a stale query doesn't bleed in.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setLoading(false)
    setAttachingId(null)
  }, [open])

  // Debounced search — 300ms after the last keystroke. Empty queries clear.
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchDriveForLead({ leadId, query: trimmed })
        setResults(rows)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, leadId, open])

  async function handleAttach(file: SuggestedDriveFile) {
    if (attachingId) return
    setAttachingId(file.driveFileId)
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
        setResults((prev) => prev.filter((r) => r.driveFileId !== file.driveFileId))
        onAttached?.()
      } else {
        toast('error', 'הצירוף נכשל. נסה שוב.')
      }
    } catch {
      toast('error', 'הצירוף נכשל. נסה שוב.')
    } finally {
      setAttachingId(null)
    }
  }

  return (
    <ModalPop open={open} pos='middle' onClose={onClose} className='w-[520px] max-w-[94vw]'>
      <div className='pt-2 grid gap-4'>
        <header className='grid gap-2'>
          <div className='flex items-center gap-2.5'>
            <Icon name='google-drive' className='size-6 bg-gray-900' />
            <h2 className='text-lg font-bold text-dark'>צרף קובץ מ-Google Drive</h2>
          </div>
          <p className='text-sm text-gray-600 leading-relaxed'>חפש בקבצים שלך ב-Drive ובחר את הקובץ לצירוף לליד.</p>
        </header>

        <div className='relative'>
          <input
            type='text'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='חפש קובץ לפי שם או תוכן…'
            className='w-full h-10 px-3 ps-9 rounded-md border border-gray-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary'
            autoFocus
          />
          <Icon
            name='magnifying-glass'
            type='reg'
            className='absolute inset-s-3 top-1/2 -translate-y-1/2 size-4 bg-gray-400'
          />
        </div>

        <div className='min-h-[200px] max-h-[360px] overflow-y-auto scrollbar-slim flex flex-col gap-1.5'>
          {loading && (
            <div className='h-20 flex items-center justify-center text-sm text-gray-500'>טוען…</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div className='h-20 flex items-center justify-center text-sm text-gray-400'>הקלד לפחות 2 תווים</div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div className='h-20 flex items-center justify-center text-sm text-gray-400'>לא נמצאו קבצים</div>
          )}
          {!loading &&
            results.map((file) => (
              <SearchResultRow
                key={file.driveFileId}
                file={file}
                attaching={attachingId === file.driveFileId}
                onAttach={() => handleAttach(file)}
              />
            ))}
        </div>

        <div className='flex justify-end'>
          <Btn lbl='סגור' variant='outline' onClick={onClose} />
        </div>
      </div>
    </ModalPop>
  )
}

function SearchResultRow({
  file,
  attaching,
  onAttach,
}: {
  file: SuggestedDriveFile
  attaching: boolean
  onAttach: () => void
}) {
  const icon = iconForDriveMime(file.mimeType)
  const date = file.modifiedTime ? file.modifiedTime.slice(0, 10) : ''

  return (
    <div
      dir='auto'
      className='flex items-center gap-2.5 rounded-xl border border-gray-100 bg-white p-2 transition-colors hover:bg-gray-50'
    >
      <div className='shrink-0 size-9 rounded-lg bg-gray-50 flex items-center justify-center'>
        <Icon name={icon} type='reg' className='size-4 bg-gray-500' />
      </div>
      <div className='flex-1 min-w-0'>
        <p dir='auto' className='text-[12.5px] font-medium text-gray-900 truncate' title={file.name}>
          {file.name}
        </p>
        {date && <p className='text-[10.5px] text-gray-400'>{date}</p>}
      </div>
      <div className='shrink-0'>
        <Btn lbl={attaching ? 'מצרף…' : 'צרף'} size='small' onClick={onAttach} disabled={attaching} />
      </div>
    </div>
  )
}
