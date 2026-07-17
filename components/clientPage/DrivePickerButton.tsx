'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useDrivePicker } from '@/lib/integrations/google/picker/useDrivePicker'
import type { PickedDriveFile } from '@/lib/integrations/google/picker/pickerCore'

type Props = {
  label?: string
  onPicked?: (files: PickedDriveFile[]) => void
}

export default function DrivePickerButton({ label = 'בחר קובץ מ-Drive', onPicked }: Props) {
  const { status, openPicker } = useDrivePicker()
  const [picked, setPicked] = useState<PickedDriveFile[]>([])

  const handleClick = () =>
    openPicker({
      onPicked: (files) => {
        setPicked(files)
        onPicked?.(files)
      },
    })

  const busy = status === 'loading' || status === 'open'

  return (
    <div className='grid gap-2'>
      <Btn lbl={busy ? 'טוען…' : label} size='small' onClick={handleClick} disabled={busy} />
      {status === 'unconfigured' && (
        <p className='text-xs text-red-500'>ה-Picker אינו מוגדר (חסרים משתני סביבה).</p>
      )}
      {status === 'error' && <p className='text-xs text-red-500'>פתיחת ה-Picker נכשלה. נסה שוב.</p>}
      {picked.length > 0 && (
        <ul className='grid gap-1 text-xs text-gray-600'>
          {picked.map((file) => (
            <li key={file.driveFileId} dir='auto' className='truncate'>
              {file.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
