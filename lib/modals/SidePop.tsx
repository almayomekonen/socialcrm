import { Btn } from '@/lib/btns/Btn'
import { JSX } from 'react'
import { twMerge } from 'tailwind-merge'

export default function SidePop({ children, className, id }: Props): JSX.Element {
  return (
    <div id={id} popover='auto'>
      <div
        className={twMerge(
          ' top-0 left-0 size-full desktop:w-[75%] bg-white z-800 shadow-2xl fixed flex  justify-center  ',
          className
        )}
      >
        <div className={twMerge(' overflow-y-auto h-full w-full shadow-2xl relative popin overflow-x-hidden scrollbar-slim ')}>
          <Btn
            variant='outline'
            size='icon'
            className='absolute top-4 left-4 rounded-full z-500 size-8'
            icon='xmark'
            popoverTarget={id}
          />

          {children}
        </div>
      </div>
    </div>
  )
}

type Props = {
  children: React.ReactNode
  className?: string
  id?: string
}
