import Link from 'next/link'
import { formatDate } from '@/lib/dates'
import { channelLabel } from '@/modules/inbox/channels'
import { ACTION_LABELS, INTENT_LABELS, TEMPERATURE_BADGES } from '@/modules/inbox/intelLabels'
import type { InboxConversationListItem } from '@/modules/inbox/types'

export default function InboxConversationRow({
  item,
  selected,
}: {
  item: InboxConversationListItem
  selected: boolean
}) {
  const attentionDot =
    item.attention === 'needs_reply' ? 'bg-amber-500' : item.attention === 'replied' ? 'bg-green-500' : 'bg-gray-300'

  // Persisted intelligence (read-only). Values without labels ('other', 'none', null) are hidden.
  const temperatureBadge = item.temperature ? TEMPERATURE_BADGES[item.temperature] : null
  const intentLabel = item.intent ? INTENT_LABELS[item.intent] : null
  const actionLabel = item.suggestedAction ? ACTION_LABELS[item.suggestedAction] : null

  return (
    <Link
      href={`/inbox?conversation=${item.conversationId}`}
      aria-current={selected ? 'true' : undefined}
      className={`block border-b border-gray-100 px-3 py-2.5 hover:bg-gray-50 ${selected ? 'bg-gray-50' : ''}`}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <span className={`size-2 shrink-0 rounded-full ${attentionDot}`} aria-hidden />
          <span className={`truncate text-sm text-gray-900 ${item.unread ? 'font-bold' : 'font-medium'}`}>
            {item.displayName ?? 'ליד'}
          </span>
        </div>
        <span className='shrink-0 text-[11px] tabular-nums text-gray-400'>
          {item.lastMessageAt ? formatDate(item.lastMessageAt) : ''}
        </span>
      </div>
      {item.lastMessagePreview && (
        <p className={`mt-0.5 truncate pr-3.5 text-xs ${item.unread ? 'text-gray-700' : 'text-gray-400'}`}>
          {item.lastDirection === 'outbound' ? 'נשלח: ' : ''}
          {item.lastMessagePreview}
        </p>
      )}
      {(temperatureBadge || intentLabel) && (
        <div className='mt-1 flex flex-wrap items-center gap-1 pr-3.5'>
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
      {actionLabel && <p className='mt-0.5 truncate pr-3.5 text-[11px] text-gray-600'>הצעד הבא: {actionLabel}</p>}
      <div className='mt-0.5 flex items-center justify-between gap-2 pr-3.5'>
        <span className='text-xs text-gray-500'>{channelLabel(item.channel)}</span>
        {item.unread && (
          <span className='inline-flex items-center gap-1 text-[11px] text-red-600'>
            <span className='size-1.5 rounded-full bg-red-500' aria-hidden />
            לא נקרא
          </span>
        )}
      </div>
    </Link>
  )
}
