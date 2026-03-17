import { JSX } from 'react'
import { twMerge } from 'tailwind-merge'
import Icon from '@/lib/Icon'

export default function ModalPop({ children, className, onClose, open, closeOutside = false, pos = 'top' }: Props): JSX.Element {
  if (!open) return null

  return (
    <div
      onClick={closeOutside ? onClose : null}
      className={`flex  justify-center fixed top-0 left-0 size-full bg-black/15 z-[99999] anim-fade-in ${
        pos === 'middle' ? 'items-center' : 'items-start'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={twMerge(
          'max-h-[90vh] overflow-y-auto bg-white p-8  shadow-md relative popin overflow-x-hidden scrollbar-slim',
          pos === 'middle' ? 'rounded-lg' : 'rounded-b-lg',
          className
        )}
      >
        <button className='absolute top-2 left-2' title='יציאה ללא שמירה' onClick={onClose}>
          <Icon name='circle-xmark' className='size-[22px] bg-red-700' />
        </button>

        {children}
      </div>
    </div>
  )
}

type Props = {
  children: React.ReactNode
  closeUrl?: string
  className?: string
  onClose: () => void
  open: boolean
  closeOutside?: boolean
  pos?: 'top' | 'middle'
}
