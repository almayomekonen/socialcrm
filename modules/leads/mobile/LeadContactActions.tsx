'use client'

import Icon from '@/lib/Icon'
import { waMeHref } from '@/modules/leads/whatsapp'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

/**
 * Call and WhatsApp — the two first-class mobile contact actions.
 *
 * Both are plain anchors, not buttons with handlers. `tel:` and `https://wa.me`
 * are real navigations the OS owns, so an anchor gets long-press, "copy number"
 * and "open in app" for free, and still works if hydration is slow — which
 * matters on the networks phones are actually on.
 *
 * ABSENT, NEVER DISABLED. With no usable phone number neither control renders.
 * A greyed-out Call button is a tap target that lies.
 *
 * Analytics: WhatsApp is a real outbound contact attempt, so it emits
 * `lead_action_taken {surface:'mobile', action:'message'}` — the shared event,
 * not a mobile-only duplicate. Call cannot be instrumented honestly here: the
 * anchor hands off to the dialer and the page may be backgrounded before any
 * handler runs, so a `tel:` click means "opened the dialer", not "called".
 * Recording it as a lead action would inflate the activation KPI with intent.
 */
export default function LeadContactActions({
  leadId,
  phone,
  size = 'row',
  className = '',
  name,
}: {
  leadId: number
  phone: string | null | undefined
  /** 'row' = 44px icon circles for list rows; 'bar' = full-width sticky bar buttons. */
  size?: 'row' | 'bar'
  className?: string
  name?: string | null
}) {
  const wa = waMeHref(phone)
  if (!phone && !wa) return null

  const onWhatsapp = () => {
    recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'message', leadId, via: 'wa.me' }).catch(
      () => {},
    )
  }

  if (size === 'bar') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {phone && (
          <a
            href={`tel:${phone}`}
            aria-label={name ? `התקשר ל${name}` : 'התקשר'}
            className='flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='phone' type='sol' className='size-4 bg-white' />
            <span>התקשר</span>
          </a>
        )}
        {wa && (
          <a
            href={wa}
            target='_blank'
            rel='noopener noreferrer'
            onClick={onWhatsapp}
            aria-label={name ? `וואטסאפ ל${name}` : 'וואטסאפ'}
            className='flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-[#25D366] font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='whatsapp' type='sol' className='size-4 bg-white' />
            <span>וואטסאפ</span>
          </a>
        )}
      </div>
    )
  }

  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      {wa && (
        <a
          href={wa}
          target='_blank'
          rel='noopener noreferrer'
          onClick={(e) => {
            e.stopPropagation()
            onWhatsapp()
          }}
          aria-label={name ? `וואטסאפ ל${name}` : 'וואטסאפ'}
          className='flex size-11 items-center justify-center rounded-full border border-gray-200 bg-white hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <Icon name='whatsapp' type='sol' className='size-4 bg-[#25D366]' />
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={name ? `התקשר ל${name}` : 'התקשר'}
          className='flex size-11 items-center justify-center rounded-full border border-gray-200 bg-white hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <Icon name='phone' type='sol' className='size-4 bg-gray-700' />
        </a>
      )}
    </div>
  )
}
