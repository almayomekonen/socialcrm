import Link from 'next/link'
import { formatDate } from '@/lib/dates'
import { channelLabel } from '@/modules/inbox/channels'
import { ACTION_LABELS, INTENT_LABELS, TEMPERATURE_BADGES } from '@/modules/inbox/intelLabels'
import type { InboxConversationListItem } from '@/modules/inbox/types'
import LeadAvatar from '@/components/ui/lead-avatar'
import ChannelIcon from './ChannelIcon'
import DeleteConversationMenu from '@/components/inbox/DeleteConversationMenu'

export default function InboxConversationRow({
  item,
  selected,
}: {
  item: InboxConversationListItem
  selected: boolean
}) {
  const unread = item.unread && !selected

  const attentionDot =
    item.attention === 'needs_reply' ? 'bg-amber-500' : item.attention === 'replied' ? 'bg-green-500' : 'bg-gray-300'

  const temperatureBadge = item.temperature ? TEMPERATURE_BADGES[item.temperature] : null
  const intentLabel = item.intent ? INTENT_LABELS[item.intent] : null
  const actionLabel = item.suggestedAction ? ACTION_LABELS[item.suggestedAction] : null

  return (
    <div className='group relative'>
      <Link
        href={`/inbox?conversation=${item.conversationId}`}
        aria-current={selected ? 'true' : undefined}
        className={`flex gap-2.5 border-b border-gray-100 ps-3 pe-8 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
          selected ? 'bg-primary-soft' : 'hover:bg-gray-50'
        }`}
      >
      <LeadAvatar name={item.displayName} size='sm' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-1.5'>
            <span className={`size-2 shrink-0 rounded-full ${attentionDot}`} aria-hidden />
            <span className={`truncate text-sm text-gray-900 ${unread ? 'font-bold' : 'font-medium'}`}>
              {item.displayName ?? 'שיחה'}
            </span>
          </div>
          <span className='shrink-0 text-[11px] tabular-nums text-gray-400'>
            {item.lastMessageAt ? formatDate(item.lastMessageAt) : ''}
          </span>
        </div>
        {item.lastMessagePreview && (
          <p className={`mt-0.5 truncate text-xs ${unread ? 'text-gray-700' : 'text-gray-400'}`}>
            {item.lastDirection === 'outbound' ? 'נשלח: ' : ''}
            {item.lastMessagePreview}
          </p>
        )}
        {item.waitingTitle && (
          <p className='mt-0.5 truncate text-[11px] font-medium text-amber-800'>{item.waitingTitle}</p>
        )}
        {item.waitingWindowHint && (
          <p className='truncate text-[11px] text-gray-500'>{item.waitingWindowHint}</p>
        )}
        {(temperatureBadge || intentLabel) && (
          <div className='mt-1 flex flex-wrap items-center gap-1'>
            {temperatureBadge && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${temperatureBadge.cls}`}>
                {temperatureBadge.label}
              </span>
            )}
            {intentLabel && (
              <span className='rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700'>
                {intentLabel}
              </span>
            )}
          </div>
        )}
        {actionLabel && <p className='mt-0.5 truncate text-[11px] text-gray-600'>הצעד הבא: {actionLabel}</p>}
        <div className='mt-0.5 flex items-center justify-between gap-2'>
          <span className='inline-flex items-center gap-1 text-xs text-gray-500'>
            <ChannelIcon channel={item.channel} className='size-3' />
            {channelLabel(item.channel)}
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
      {/* Row actions live OUTSIDE the <Link> (no button-in-anchor), in the reserved
          right gutter (pe-8 above). The trigger fades in on hover/focus and the
          menu itself is portaled, so it is never clipped by the list scroll area
          or covered by the next row. */}
      <div className='absolute end-1.5 top-1/2 -translate-y-1/2'>
        <DeleteConversationMenu conversationId={item.conversationId} revealOnHover />
      </div>
    </div>
  )
}
