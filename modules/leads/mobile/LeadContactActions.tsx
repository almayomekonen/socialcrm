'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import { openLeadWhatsappInInbox, WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

/**
 * Call and WhatsApp — the two first-class mobile contact actions.
 *
 * ── WhatsApp ALWAYS stays INSIDE SocialCRM ──────────────────────────────────
 *
 * Connected: resolve the REAL conversation (`resolveLeadWhatsappConversation` →
 * find, else `ensureWhatsappConversationForLead`) and navigate to
 * `/inbox?conversation=<id>`. Same server action the desktop table and the
 * dashboard quick-actions use — no second lookup, no invented conversation.
 *
 * NOT connected: navigate to the WhatsApp connect UI —
 * `/settings/integrations?section=whatsapp`. There is no `wa.me` fallback.
 *
 * WHY THE FALLBACK IS GONE. It opened `window.open(wa.me)` from inside
 * `onUnavailable`, i.e. AFTER an awaited server action had already resolved. By
 * then the browser's transient user activation was spent, so mobile suppressed
 * the popup and the FIRST TAP DID NOTHING AT ALL — no navigation, no toast,
 * because the wa.me branch returned before the toast could run. The second tap
 * worked only because the warm server action answered inside the activation
 * window. Reproduced on device; see the audit. Routing through `router.push`
 * has no such dependency: client-side navigation is never gesture-gated, so it
 * is correct on the first tap, on mobile, and in PWA standalone — where
 * `_blank` is unreliable anyway.
 *
 * It also ends a split personality: desktop told the rep to connect WhatsApp
 * while mobile silently ejected them to another app. Both now lead to the same
 * place; mobile just takes them there instead of describing it.
 *
 * Call is unchanged: `tel:` is a real OS navigation and belongs to the dialer.
 *
 * ANALYTICS. Still the shared `lead_action_taken {surface:'mobile'}` event, with
 * `via` recording which path was taken. NOTE it is recorded on TAP, before the
 * outcome is known — it measures intent, not a delivered conversation.
 * Call stays uninstrumented: the anchor hands off to the dialer and the page may
 * be backgrounded before any handler runs, so recording it would inflate the
 * activation KPI with intent rather than contact.
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
  /** 'row' = icon buttons for list rows; 'bar' = full-width sticky bar buttons. */
  size?: 'row' | 'bar'
  className?: string
  name?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  // `waMeHref(phone)` used to widen this guard; it was always derived from
  // `phone`, so dropping it changes nothing about when the action renders.
  if (!phone) return null

  const openWhatsapp = () => {
    if (busy || pending) return
    setBusy(true)
    recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'message', leadId, via: 'inbox' }).catch(
      () => {},
    )
    startTransition(async () => {
      try {
        await openLeadWhatsappInInbox(leadId, (href) => router.push(href), {
          // No WhatsApp connected: take the rep to the connect UI rather than
          // out of the product.
          onNoConnection: () => router.push(WHATSAPP_CONNECT_HREF),
        })
      } finally {
        setBusy(false)
      }
    })
  }

  const working = busy || pending

  if (size === 'bar') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {phone && (
          <a
            href={`tel:${phone}`}
            aria-label={name ? `התקשר ל${name}` : 'התקשר'}
            className='press flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='phone' type='sol' className='size-4 bg-white' />
            <span>התקשר</span>
          </a>
        )}
        <button
          type='button'
          onClick={openWhatsapp}
          disabled={working}
          aria-label={name ? `וואטסאפ ל${name}` : 'וואטסאפ'}
          className='press flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-[#25D366] font-medium text-white hover:opacity-90 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <Icon name={working ? 'spinner' : 'whatsapp'} type='sol' className={`size-4 bg-white ${working ? 'animate-spin' : ''}`} />
          <span>{working ? 'פותח…' : 'וואטסאפ'}</span>
        </button>
      </div>
    )
  }

  /**
   * ROW VARIANT — quiet chrome, but the glyphs carry their real colour.
   *
   * Earlier iterations went outlined-ring → filled-circle → all-grey. Grey was
   * calm but it also made the two most useful actions in the product look
   * disabled. The chrome stays absent (no ring, no fill) so thirty rows do not
   * turn into a wall of buttons, while the glyphs keep the colours that make
   * them recognisable at a glance: WhatsApp green, and the SocialCRM primary for
   * call. Colour is doing identification work here, not decoration.
   *
   * GEOMETRY UNCHANGED throughout: `size-11` (44px), `gap-1.5`, centres 50px
   * apart, so hit areas cannot collide.
   */
  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      <button
        type='button'
        onClick={(e) => {
          e.stopPropagation()
          openWhatsapp()
        }}
        disabled={working}
        aria-label={name ? `וואטסאפ ל${name}` : 'וואטסאפ'}
        className='press flex size-11 items-center justify-center rounded-full active:bg-[#25D366]/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon
          name={working ? 'spinner' : 'whatsapp'}
          type='sol'
          className={`size-5 bg-[#25D366] ${working ? 'animate-spin' : ''}`}
        />
      </button>

      {phone && (
        <a
          href={`tel:${phone}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={name ? `התקשר ל${name}` : 'התקשר'}
          className='press flex size-11 items-center justify-center rounded-full active:bg-primary-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <Icon name='phone' type='sol' className='size-5 bg-primary' />
        </a>
      )}
    </div>
  )
}
