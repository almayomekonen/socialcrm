'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useDrivePicker } from '@/lib/integrations/google/picker/useDrivePicker'
import { attachDriveFile } from '@/actions/leadDriveFiles'
import type { PickedDriveFile } from '@/lib/integrations/google/picker/pickerCore'

type Props = {
  leadId: number
  onRepicked?: () => void
}

/**
 * Per-attachment re-pick safety net (rendered only when DRIVE_PICKER_ENABLED).
 *
 * Reuses the Phase 1 Picker infrastructure (useDrivePicker) to let a נציג
 * re-select a file from Drive and re-attach it through the existing
 * attachDriveFile action. After the future drive.file cutover (Phase 6), an
 * attachment stored under the old drive.readonly grant can become unreadable;
 * re-picking the file re-grants per-file access and refreshes the row.
 *
 * Additive and storage-model-safe: attachDriveFile upserts by
 * (lead_id, drive_file_id), so re-picking the same file recovers the existing
 * row without schema or id changes.
 */
export default function LeadDriveRepickButton({ leadId, onRepicked }: Props) {
  const { status, openPicker } = useDrivePicker()
  const [working, setWorking] = useState(false)

  async function handlePicked(files: PickedDriveFile[]) {
    if (files.length === 0) return
    setWorking(true)
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
    setWorking(false)
    if (ok > 0) {
      toast('success', 'הקובץ עודכן מ-Drive')
      onRepicked?.()
    } else {
      toast('error', 'העדכון נכשל. נסה שוב.')
    }
  }

  const busy = status === 'loading' || status === 'open' || working

  return (
    <Btn
      lbl={busy ? 'טוען…' : 'צרף מחדש'}
      size='small'
      variant='outline'
      onClick={() => openPicker({ onPicked: handlePicked })}
      disabled={busy}
    />
  )
}
