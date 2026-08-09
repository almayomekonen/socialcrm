import { twMerge } from 'tailwind-merge'
import Icon, { IconNames } from '@/lib/Icon'

interface AccordionItemProps {
  title: string
  children: React.ReactNode
  className?: string
  bodyClass?: string
  icon?: IconNames
  open?: boolean
  badge?: React.ReactNode
  /** Stable section id — lets UrlSyncedAccordion map this <details> to a URL param. */
  id?: string
  /**
   * Overrides the leading icon's colour. Default (omitted) keeps the shipped
   * behaviour exactly: neutral when closed, brand purple when open.
   *
   * Pass a brand colour for rows that represent an external product, and pass
   * the `group-open` variant too — otherwise the default turns the icon purple
   * the moment the row is opened and the brand recognition is lost precisely
   * when the user is looking at it.
   */
  iconClassName?: string
}

export default function AccordionItem({
  title,
  className,
  children,
  bodyClass,
  icon,
  open,
  badge,
  id,
  iconClassName,
}: AccordionItemProps) {
  return (
    <details id={id} name='x' className='group/acrdn border-b-2 last:border-b-0' open={open}>
      <summary className={className}>
        <div className='flex items-center gap-2'>
          {icon && <Icon type='reg' className={twMerge('group-open/acrdn:bg-solid', iconClassName)} name={icon} />}
          <p className='group-open/acrdn:text-solid'>{title}</p>
          {badge}
        </div>
        {/* Chevron darkens on row hover — the only affordance signalling the
            whole summary is clickable, not just the title. */}
        <Icon
          name='chevron-left'
          className='duration-200 group-hover/acrdn:bg-gray-950 group-open/acrdn:rotate-90 group-open/acrdn:bg-solid'
        />
      </summary>
      <div className={bodyClass}>{children}</div>
    </details>
  )
}
