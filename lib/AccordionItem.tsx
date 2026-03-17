import Icon, { IconNames } from '@/lib/Icon'

interface AccordionItemProps {
  title: string
  children: React.ReactNode
  className?: string
  bodyClass?: string
  icon?: IconNames
  open?: boolean
}

export default function AccordionItem({ title, className, children, bodyClass, icon, open }: AccordionItemProps) {
  return (
    <details name='x' className='group/acrdn border-b-2 last:border-b-0' open={open}>
      <summary className={className}>
        <div className='flex'>
          {icon && <Icon type='reg' className='group-open/acrdn:bg-solid' name={icon} />}
          <p className='group-open/acrdn:text-solid'>{title}</p>
        </div>
        <Icon name='chevron-left' className='duration-200 group-open/acrdn:rotate-90 group-open/acrdn:bg-solid' />
      </summary>
      <div className={bodyClass}>{children}</div>
    </details>
  )
}
