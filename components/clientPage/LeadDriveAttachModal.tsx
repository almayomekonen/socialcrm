'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import { toast } from '@/lib/toast'
import { iconForDriveMime } from '@/lib/copilot/driveMimeIcon'
import { attachDriveFile } from '@/actions/leadDriveFiles'
import { searchDriveForLead, type SuggestedDriveFile } from '@/actions/leadDriveFilesSearch'
import LeadDrivePickerAttach from './LeadDrivePickerAttach'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'
import { driveModifiedDate } from './driveModifiedDate'

type Props = {
  open: boolean
  onClose: () => void
  leadId: number
  onAttached?: () => void
  pickerEnabled?: boolean
}

/** Attach dialog of the lead files tab; portalled, so it declares the interface language (`translated`). */
export default function LeadDriveAttachModal({ open, onClose, leadId, onAttached, pickerEnabled = false }: Props) {
  const t = useT()
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
        toast('success', t('leadTabs.drive.attached'))
        setResults((prev) => prev.filter((r) => r.driveFileId !== file.driveFileId))
        onAttached?.()
      } else {
        toast('error', t('leadTabs.drive.attachFailed'))
      }
    } catch {
      toast('error', t('leadTabs.drive.attachFailed'))
    } finally {
      setAttachingId(null)
    }
  }

  return (
    <ModalPop open={open} pos='middle' onClose={onClose} label={t('leadTabs.drive.dialog.label')} className='w-[520px] max-w-[94vw]' translated>
      <div className='pt-2 grid gap-4'>
        <header className='grid gap-2'>
          <div className='flex items-center gap-2.5'>
            <Icon name='google-drive' className='size-6 bg-gray-900' />
            <h2 className='text-lg font-bold text-dark'>{t('leadTabs.drive.dialog.title')}</h2>
          </div>
          {!pickerEnabled && (
            <p className='text-sm text-gray-600 leading-relaxed'>{t('leadTabs.drive.dialog.intro')}</p>
          )}
        </header>

        {pickerEnabled ? (
          <LeadDrivePickerAttach
            leadId={leadId}
            onAttached={() => {
              onAttached?.()
              onClose()
            }}
          />
        ) : (
          <>
        <div className='relative'>
          <input
            type='text'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('leadTabs.drive.dialog.searchPlaceholder')}
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
            <div className='h-20 flex items-center justify-center text-sm text-gray-500'>{t('leadTabs.drive.loading')}</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div className='h-20 flex items-center justify-center text-sm text-gray-400'>{t('leadTabs.drive.dialog.minChars')}</div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div className='h-20 flex items-center justify-center text-sm text-gray-400'>{t('leadTabs.drive.dialog.noResults')}</div>
          )}
          {!loading &&
            results.map((file) => (
              <SearchResultRow
                key={file.driveFileId}
                t={t}
                file={file}
                attaching={attachingId === file.driveFileId}
                onAttach={() => handleAttach(file)}
              />
            ))}
        </div>
          </>
        )}

        <div className='flex justify-end'>
          <Btn lbl={t('leadTabs.drive.dialog.close')} variant='outline' onClick={onClose} />
        </div>
      </div>
    </ModalPop>
  )
}

function SearchResultRow({
  t,
  file,
  attaching,
  onAttach,
}: {
  t: Translator
  file: SuggestedDriveFile
  attaching: boolean
  onAttach: () => void
}) {
  const icon = iconForDriveMime(file.mimeType)
  const date = driveModifiedDate(file.modifiedTime, t.locale)

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
        <Btn lbl={attaching ? t('leadTabs.drive.attaching') : t('leadTabs.drive.attachOne')} size='small' onClick={onAttach} disabled={attaching} />
      </div>
    </div>
  )
}
