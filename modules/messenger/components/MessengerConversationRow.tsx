import Link from 'next/link'
import { formatBusinessDate as formatDate } from '@/lib/today/time'
import LeadAvatar from '@/components/ui/lead-avatar'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import type { MessengerConversationListItem } from '../types'

/**
 * One Messenger conversation in the list. Same anatomy as
 * InboxConversationRow — avatar, name, date, preview, channel footer, unread —
 * so Messenger reads as part of שיחות rather than a second product.
 */
export default function MessengerConversationRow({
  item,
  selected,
}: {
  item: MessengerConversationListItem
  selected: boolean
}) {
  const unread = item.unread && !selected
  const name = item.leadName ?? item.customerName ?? 'פונה מ-Messenger'

  return (
    <Link
      href={`/inbox/messenger?c=${item.id}`}
      aria-current={selected ? 'true' : undefined}
      className={`flex gap-2.5 border-b border-gray-100 px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
        selected ? 'bg-primary-soft' : 'hover:bg-gray-50'
      }`}
    >
      <LeadAvatar name={name} size='sm' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between gap-2'>
          <span className={`truncate text-sm text-gray-900 ${unread ? 'font-bold' : 'font-medium'}`}>{name}</span>
          <span suppressHydrationWarning className='shrink-0 text-[11px] tabular-nums text-gray-400'>
            {item.lastMessageAt ? formatDate(item.lastMessageAt) : ''}
          </span>
        </div>
        {item.lastMessageText && (
          <p className={`mt-0.5 truncate text-xs ${unread ? 'text-gray-700' : 'text-gray-400'}`}>
            {item.lastDirection === 'outbound' ? 'נשלח: ' : ''}
            {item.lastMessageText}
          </p>
        )}
        <div className='mt-0.5 flex items-center justify-between gap-2'>
          <span className='inline-flex items-center gap-1 text-xs text-gray-500'>
            <ChannelIcon channel='messenger' className='size-3' />
            Messenger
            {item.leadId ? <span className='text-gray-400'>· ליד</span> : null}
          </span>
          {unread && (
            <span className='inline-flex items-center gap-1 text-[11px] font-medium text-success-text'>
              <span className='size-1.5 rounded-full bg-success' aria-hidden />
              לא נקרא
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
