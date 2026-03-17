import { twMerge } from 'tailwind-merge'
import Icon, { IconNames } from '@/lib/Icon'

type Props = {
  lbl: string
  icon?: IconNames
  className?: string
  iconClassName?: string
  flip?: boolean
}

export default function Title({ lbl, icon, className, iconClassName, flip }: Props) {
  return (
    <div className={twMerge('inline-flex items-center gap-4 border-b pb-2 border-gray-400', className)}>
      {icon && <Icon name={icon} type='reg' className={iconClassName} flip={flip} />}
      <p className='text-lg font-medium'>{lbl}</p>
    </div>
  )
}
