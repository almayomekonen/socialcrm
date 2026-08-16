import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { BriefItem } from '@/lib/today/types'

// Presentational (RSC). The single next action — the eye magnet. Today is a
// pointer: the primary act is a plain tel: link (no client JS) and a link to the
// lead workspace where outcomes are logged; the brief refreshes server-side on return.
export default function BriefMission({ item }: { item: BriefItem }) {
  const href = item.href ?? `/clients/${item.id}/summary`
  const openConversation = Boolean(item.conversationId || item.href?.startsWith('/inbox'))

  return (
    <div className='rounded-2xl border border-border bg-gradient-to-b from-primary-tint to-surface p-6 shadow-md sm:p-7'>
      <div className='flex items-center gap-1.5 text-primary-text'>
        <Icon name='bolt' className='size-4 bg-primary-text' />
        <span className='text-xs font-semibold tracking-wide'>
          {openConversation ? 'צריך לטפל עכשיו' : 'המשימה הבאה'}
        </span>
      </div>

      <Link
        href={href}
        className='mt-3 block truncate text-2xl font-semibold text-ink hover:underline sm:text-3xl'
      >
        {item.name || '—'}
      </Link>
      <p className='mt-2 text-sm text-gray-600 tabular-nums'>
        {item.waitingFor ?? item.reason}
        {!openConversation && item.phone ? ` · ${item.phone}` : ''}
      </p>
      {item.windowHint && <p className='mt-1 text-sm text-gray-500'>{item.windowHint}</p>}

      <div className='mt-6 flex flex-wrap items-center gap-2.5'>
        {openConversation ? (
          <Link
            href={href}
            className='inline-flex h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85'
          >
            פתח שיחה
          </Link>
        ) : (
          <>
            {item.phone && (
              <a
                href={`tel:${item.phone}`}
                className='inline-flex h-11 items-center gap-2 rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85'
              >
                <Icon name='phone' className='size-4 bg-white' />
                התקשר
              </a>
            )}
            <Link
              href={href}
              className='inline-flex h-11 items-center rounded-md border border-gray-200 bg-white px-4 font-medium text-black hover:bg-gray-100/60'
            >
              פתח ליד
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
