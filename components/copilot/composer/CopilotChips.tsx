'use client'

import Icon from '@/lib/Icon'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import { ATTACHMENT_STATUS_LABEL, LENS_ICON, LENS_LABEL, type AttachmentItem } from './constants'

export function LensChip({ id, onRemove }: { id: LensId; onRemove: () => void }) {
  return (
    <span className='group inline-flex items-center gap-1 h-6 ps-2 pe-1 rounded-full bg-primary-tint text-primary-text text-xs font-medium'>
      <Icon name={LENS_ICON[id]} type='reg' className='size-3 bg-primary' />
      <span className='truncate max-w-[120px]'>{LENS_LABEL[id]}</span>
      <button
        type='button'
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={`הסר ${LENS_LABEL[id]}`}
        className='shrink-0 inline-flex items-center justify-center size-4 rounded-full hover:bg-primary-soft transition-colors'
      >
        <Icon name='xmark' type='reg' className='size-2.5 bg-primary' />
      </button>
    </span>
  )
}

export function FileChip({ item, onRemove }: { item: AttachmentItem; onRemove: () => void }) {
  const label = ATTACHMENT_STATUS_LABEL[item.status]
  const tone = item.status === 'unreadable' || item.status === 'error' ? 'text-gray-400' : 'text-gray-600'
  return (
    <span className='group inline-flex items-center gap-1 h-6 ps-2 pe-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium'>
      <Icon name='paperclip' type='reg' className='size-3 bg-gray-500' />
      <span className='truncate max-w-[120px]' title={item.file.name}>
        {item.file.name}
      </span>
      {label && <span className={`text-xs font-normal ${tone}`}>{label}</span>}
      <button
        type='button'
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={`הסר ${item.file.name}`}
        className='shrink-0 inline-flex items-center justify-center size-4 rounded-full hover:bg-gray-200 transition-colors'
      >
        <Icon name='xmark' type='reg' className='size-2.5 bg-gray-500' />
      </button>
    </span>
  )
}
