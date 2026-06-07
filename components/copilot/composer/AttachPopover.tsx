'use client'

import Icon from '@/lib/Icon'
import { LENS_IDS, type LensId } from '@/lib/ai/prompts/leadAskQuestion'
import { LENS_ICON, LENS_LABEL, POP_KEYFRAMES } from './constants'

export function AttachPopover({
  selected,
  onToggle,
  onUpload,
  onClose,
}: {
  selected: LensId[]
  onToggle: (id: LensId) => void
  onUpload: () => void
  onClose: () => void
}) {
  return (
    <div
      role='menu'
      className={[
        'absolute bottom-full mb-2 inline-flex flex-col gap-0.5',
        'rounded-2xl bg-white border border-gray-200 p-1.5 min-w-[220px]',
        'shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]',
        'start-2',
      ].join(' ')}
      style={{ animation: 'cp-pop-in 140ms ease-out' }}
    >
      <style>{POP_KEYFRAMES}</style>
      <div className='px-2.5 pt-1 pb-1 text-[10.5px] text-gray-400 tracking-wide'>הוסף הקשר</div>
      {LENS_IDS.map((id) => {
        const isSelected = selected.includes(id)
        return (
          <button
            key={id}
            type='button'
            role='menuitemcheckbox'
            aria-checked={isSelected}
            onClick={() => {
              onToggle(id)
              onClose()
            }}
            className={[
              'group flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start',
              'transition-colors duration-150',
              isSelected ? 'bg-primary-tint' : 'hover:bg-gray-50',
            ].join(' ')}
          >
            <Icon
              name={LENS_ICON[id]}
              type='reg'
              className={`size-3.5 shrink-0 transition-colors ${isSelected ? 'bg-primary' : 'bg-gray-400 group-hover:bg-primary'}`}
            />
            <span
              className={`text-[12.5px] truncate transition-colors ${isSelected ? 'text-primary-text' : 'text-gray-700 group-hover:text-gray-900'}`}
            >
              {LENS_LABEL[id]}
            </span>
            {isSelected && (
              <Icon name='check' type='reg' className='ms-auto size-3 bg-primary shrink-0' aria-hidden='true' />
            )}
          </button>
        )
      })}

      <div className='my-1 h-px bg-gray-100' role='separator' aria-hidden='true' />

      <button
        type='button'
        role='menuitem'
        onClick={onUpload}
        className='group flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-gray-50 transition-colors duration-150'
      >
        <Icon
          name='arrow-up-from-bracket'
          type='reg'
          className='size-3.5 shrink-0 bg-gray-400 group-hover:bg-primary transition-colors'
        />
        <span className='text-[12.5px] text-gray-700 group-hover:text-gray-900 truncate'>העלאת קובץ</span>
      </button>
    </div>
  )
}
