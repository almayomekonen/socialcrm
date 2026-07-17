'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useDrivePicker } from '@/lib/integrations/google/picker/useDrivePicker'
import { attachDriveFile } from '@/actions/leadDriveFiles'
import type { PickedDriveFile } from '@/lib/integrations/google/picker/pickerCore'

type Props = {
  leadId: number
  onAttached?: () => void
}

/**
 * Picker-based attach body for the lead attach modal (flag-on path). Opens the
 * Google Picker via the shared `useDrivePicker` hook and attaches each selected
 * file through the existing `attachDriveFile` server action — the write path is
 * unchanged, only the file-selection mechanism differs from the search flow.
 */
export default function LeadDrivePickerAttach({ leadId, onAttached }: Props) {
  const { status, openPicker } = useDrivePicker()
  const [attaching, setAttaching] = useState(false)

  async function handlePicked(files: PickedDriveFile[]) {
    if (files.length === 0) return
    setAttaching(true)
    let ok = 0
    for (const file of files) {
      try {
        const res = await attachDriveFile({
          leadId,
          driveFileId: file.driveFileId,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
        })
        if (res.ok) ok++
      } catch {
        // counted as a failure below
      }
    }
    setAttaching(false)
    if (ok > 0) {
      toast('success', ok === 1 ? 'הקובץ צורף לליד' : `צורפו ${ok} קבצים`)
      onAttached?.()
    } else {
      toast('error', 'הצירוף נכשל. נסה שוב.')
    }
  }

  const busy = status === 'loading' || status === 'open' || attaching

  return (
    <div className='grid gap-3'>
      <p className='text-sm text-gray-600 leading-relaxed'>בחר קובץ מ-Drive לצירוף לליד.</p>
      <Btn
        lbl={busy ? 'טוען…' : 'בחר קובץ מ-Drive'}
        size='small'
        onClick={() => openPicker({ onPicked: handlePicked })}
        disabled={busy}
      />
      {status === 'unconfigured' && <p className='text-xs text-red-500'>ה-Picker אינו מוגדר.</p>}
      {status === 'error' && <p className='text-xs text-red-500'>פתיחת ה-Picker נכשלה. נסה שוב.</p>}
    </div>
  )
}
