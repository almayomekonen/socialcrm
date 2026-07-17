'use client'

import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import { iconForDriveMime } from '@/lib/copilot/driveMimeIcon'
import type { LeadDriveAttachment } from '@/actions/leadDriveFiles'
import LeadDriveRepickButton from './LeadDriveRepickButton'

export default function LeadDriveAttachedRow({
  attachment,
  busy,
  onDetach,
  pickerEnabled = false,
  leadId,
  onRepicked,
}: {
  attachment: LeadDriveAttachment
  busy: boolean
  onDetach: () => void
  pickerEnabled?: boolean
  leadId?: number
  onRepicked?: () => void
}) {
  const icon = iconForDriveMime(attachment.mimeType)
  const url = attachment.webViewLink ?? ''

  function open() {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      dir='auto'
      className='flex items-center gap-2.5 rounded-xl border border-gray-100 bg-white p-2 transition-colors hover:bg-gray-50'
    >
      <div className='shrink-0 size-9 rounded-lg bg-gray-50 flex items-center justify-center'>
        <Icon name={icon} type='reg' className='size-4 bg-gray-500' />
      </div>
      <div className='flex-1 min-w-0'>
        <p dir='auto' className='text-[13px] font-medium text-gray-900 truncate' title={attachment.name}>
          {attachment.name}
        </p>
      </div>
      <div className='shrink-0 flex items-center gap-1.5'>
        {pickerEnabled && leadId != null && <LeadDriveRepickButton leadId={leadId} onRepicked={onRepicked} />}
        <Btn lbl='פתח' size='small' variant='outline' onClick={open} disabled={!url || busy} />
        <Btn lbl='הסר' size='small' variant='destructive' onClick={onDetach} disabled={busy} />
      </div>
    </div>
  )
}
