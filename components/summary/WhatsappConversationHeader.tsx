import Link from 'next/link'
import { Contact, Phone } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import LeadAvatar from '@/components/ui/lead-avatar'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import LeadlessConversationActions from '@/components/inbox/LeadlessConversationActions'

const QUICK_ACTION_CLS =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

/**
 * Pinned conversation header: who the customer is, the channel, and the quick
 * actions. Falls back to a compact channel-only header when no customer
 * identity is available (the lead summary page).
 */
export default function WhatsappConversationHeader({
  displayName,
  leadStatus,
  customerWaId,
  leadId,
  conversationId = null,
  isPersonal = false,
  lastDirection,
  lastActivityAt,
}: {
  displayName: string | null
  leadStatus: string | null
  customerWaId: string | null
  leadId: number | null
  conversationId?: number | null
  isPersonal?: boolean
  lastDirection: 'inbound' | 'outbound' | null
  lastActivityAt: string | null
}) {
  const attention =
    lastDirection === null
      ? null
      : lastDirection === 'inbound'
        ? { label: 'דורש מענה', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' }
        : { label: 'הנציג השיב לאחרונה', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' }

  return (
    <div className='flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 bg-white px-4 py-2.5'>
      {displayName ? (
        <div className='flex min-w-0 items-center gap-3'>
          <LeadAvatar name={displayName} size='lg' />
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-2'>
              <h1 className='truncate text-base font-bold text-gray-900'>{displayName}</h1>
              {leadStatus && (
                <span className='shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600'>
                  {leadStatus}
                </span>
              )}
            </div>
            <div className='mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500'>
              <ChannelIcon channel='whatsapp' />
              <span className='truncate' suppressHydrationWarning>
                WhatsApp
                {customerWaId ? ' · ' : ''}
                {customerWaId && (
                  <span dir='ltr' className='tabular-nums'>
                    +{customerWaId}
                  </span>
                )}
                {lastActivityAt ? ` · פעילות אחרונה ${formatDate(lastActivityAt)}` : ''}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className='flex items-center gap-2'>
          <ChannelIcon channel='whatsapp' className='size-5' />
          <h1 className='text-base font-bold text-gray-900'>שיחת WhatsApp</h1>
        </div>
      )}

      <div className='flex items-center gap-1.5'>
        {attention && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${attention.bg} ${attention.text} ${attention.border}`}
          >
            <span className={`size-1.5 rounded-full ${attention.dot}`} />
            {attention.label}
          </span>
        )}
        {displayName && customerWaId && (
          <a href={`tel:+${customerWaId}`} className={QUICK_ACTION_CLS}>
            <Phone aria-hidden className='size-3.5' />
            התקשר
          </a>
        )}
        {leadId != null && displayName && (
          <Link href={`/clients/${leadId}/summary`} className={QUICK_ACTION_CLS}>
            <Contact aria-hidden className='size-3.5' />
            כרטיס ליד
          </Link>
        )}
        {leadId == null && conversationId != null && (
          <LeadlessConversationActions conversationId={conversationId} isPersonal={isPersonal} />
        )}
      </div>
    </div>
  )
}
