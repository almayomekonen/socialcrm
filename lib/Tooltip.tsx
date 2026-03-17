import { twMerge } from 'tailwind-merge'

type ToolTipProps = {
  children: React.ReactNode
  lbl?: React.ReactNode
  className?: string
  pos?: 'top' | 'bottom' | 'bottom-right' | 'left'
  stayOnHover?: boolean
}

export function ToolTip({ children, lbl, className, pos = 'top', stayOnHover = false }: ToolTipProps) {
  const posClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    'bottom-right': 'top-full left-0 ml-2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  }

  return (
    <div className='relative inline-flex w-fit font-medium'>
      <span className='peer inline-flex w-fit'>{children}</span>

      {lbl && (
        <div
          role='tooltip'
          className={twMerge(
            'invisible absolute border z-999 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-sm text-black opacity-0 shadow-xl transition-all peer-hover:visible peer-hover:opacity-100  ',
            stayOnHover && 'hover:visible hover:opacity-100',
            !stayOnHover && 'pointer-events-none',
            posClasses[pos],
            className
          )}
        >
          {lbl}
        </div>
      )}
    </div>
  )
}
