import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { BriefItem } from '@/lib/today/types'

// Presentational (RSC). The single next action — the eye magnet. Today is a
// pointer: the primary act is a plain tel: link (no client JS) and a link to the
// lead workspace where outcomes are logged; the brief refreshes server-side on return.
// The dark-card shades below have no theme token; they are tints of `ink`.
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const primaryBtn = `inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-accent ${focusRing}`
const outlineBtn = `inline-flex h-11 items-center justify-center rounded-[10px] border border-[#2c4566] px-4 text-[15px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-[#16365a] ${focusRing}`

export default function BriefMission({ item }: { item: BriefItem }) {
  const href = item.href ?? `/clients/${item.id}/summary`
  const openConversation = Boolean(item.conversationId || item.href?.startsWith('/inbox'))
  const meta = [item.waitingFor ?? item.reason, item.windowHint, !openConversation ? item.phone : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className='flex min-w-0 flex-[1_1_340px] flex-col justify-between gap-3.5 rounded-2xl bg-ink px-6 py-[22px] text-white'>
      <div className='flex items-center gap-2 text-accent'>
        <Icon name='bolt' className='size-4 bg-accent' />
        <span className='text-sm font-semibold'>{openConversation ? 'צריך לטפל עכשיו' : 'המשימה הבאה'}</span>
      </div>

      <div className='min-w-0'>
        <Link href={href} className={`block truncate text-[26px] font-bold text-white hover:underline ${focusRing}`}>
          {item.name || '—'}
        </Link>
        <p className='mt-0.5 text-[15px] text-[#c7cbe6] tabular-nums'>{meta}</p>
      </div>

      <div className='flex gap-2'>
        {openConversation ? (
          <>
            <Link href={href} className={primaryBtn}>
              פתח שיחה
            </Link>
            {item.phone && (
              <a
                href={`tel:${item.phone}`}
                aria-label={`התקשר ל${item.name || 'ליד'}`}
                className={`${outlineBtn} w-[46px] shrink-0 px-0`}
              >
                <Icon name='phone' className='size-[18px] bg-white' />
              </a>
            )}
          </>
        ) : (
          <>
            {item.phone && (
              <a href={`tel:${item.phone}`} className={primaryBtn}>
                <Icon name='phone' className='size-4 bg-white' />
                התקשר
              </a>
            )}
            <Link href={href} className={`${outlineBtn} ${item.phone ? '' : 'flex-1'}`}>
              פתח ליד
            </Link>
          </>
        )}
      </div>
    </section>
  )
}
