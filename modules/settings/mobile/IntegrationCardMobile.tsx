import type { ReactNode } from 'react'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'

/**
 * One integration on the phone landing — icon, live status, what to do next.
 *
 * The card is a stack, not a table row and not a desktop accordion header.
 * A single full-width CTA (min 44px) is the only control, so there is no nested
 * interactive inside a tappable row.
 */

export default function IntegrationCardMobile({
  title,
  leading,
  statusLabel,
  explanation,
  actionLabel,
  role,
  onAction,
  actionHref,
  actionDisabled,
}: {
  title: string
  leading: ReactNode
  statusLabel: string
  explanation: string
  actionLabel: string
  role: StatusRole
  onAction?: () => void
  actionHref?: string
  actionDisabled?: boolean
}) {
  const actionClass =
    'press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60'

  return (
    <article className='rounded-xl border border-gray-200 bg-white p-4'>
      <div className='flex items-start gap-3'>
        <div className='shrink-0'>{leading}</div>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-[15px] font-semibold leading-tight text-ink'>{title}</h2>
            <StatusBadge role={role} label={statusLabel} size='xs' />
          </div>
          <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>{explanation}</p>
        </div>
      </div>

      {actionHref ? (
        <a href={actionHref} className={`${actionClass} mt-4`}>
          {actionLabel}
        </a>
      ) : (
        <button
          type='button'
          className={`${actionClass} mt-4`}
          onClick={onAction}
          disabled={actionDisabled}
          aria-busy={actionDisabled || undefined}
        >
          {actionLabel}
        </button>
      )}
    </article>
  )
}
