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
  expired = false,
  pickerEnabled = false,
  leadId,
  onRepicked,
}: {
  attachment: LeadDriveAttachment
  busy: boolean
  onDetach: () => void
  /** Withholds the mutating controls while the subscription is lapsed. */
  expired?: boolean
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
        {/*
          "פתח" stays: opening an attached file is reading, and reading never
          lapses. Re-pick and "הסר" both call requireProductAccess-guarded
          actions, so they are withheld rather than left to fail into a
          generic retry toast.
        */}
        {!expired && pickerEnabled && leadId != null && (
          <LeadDriveRepickButton leadId={leadId} onRepicked={onRepicked} />
        )}
        <Btn lbl='פתח' size='small' variant='outline' onClick={open} disabled={!url || busy} />
        {!expired && <Btn lbl='הסר' size='small' variant='destructive' onClick={onDetach} disabled={busy} />}
      </div>
    </div>
  )
}
