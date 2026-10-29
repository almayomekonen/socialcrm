'use client'

import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import { iconForDriveMime } from '@/lib/copilot/driveMimeIcon'
import type { SuggestedDriveFile } from '@/actions/leadDriveFilesSearch'
import { useT } from '@/lib/i18n/I18nProvider'
import { driveModifiedDate } from './driveModifiedDate'

export default function LeadDriveSuggestionRow({
  file,
  busy,
  onAttach,
}: {
  file: SuggestedDriveFile
  busy: boolean
  onAttach: () => void
}) {
  const t = useT()
  const icon = iconForDriveMime(file.mimeType)
  const date = driveModifiedDate(file.modifiedTime, t.locale)

  return (
    <div
      dir='auto'
      className='flex items-center gap-2.5 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-2 transition-colors hover:bg-gray-50'
    >
      <div className='shrink-0 size-9 rounded-lg bg-white flex items-center justify-center'>
        <Icon name={icon} type='reg' className='size-4 bg-gray-500' />
      </div>
      <div className='flex-1 min-w-0'>
        <p dir='auto' className='text-[12.5px] font-medium text-gray-900 truncate' title={file.name}>
          {file.name}
        </p>
        {date && <p className='text-[10.5px] text-gray-400'>{date}</p>}
      </div>
      <div className='shrink-0'>
        <Btn
          lbl={busy ? t('leadTabs.drive.attaching') : t('leadTabs.drive.attachOne')}
          size='small'
          onClick={onAttach}
          disabled={busy}
        />
      </div>
    </div>
  )
}
