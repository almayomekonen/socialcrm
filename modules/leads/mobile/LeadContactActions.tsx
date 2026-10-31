'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { openLeadWhatsappInInbox, WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { resolveLeadContactPlan } from '@/modules/leads/contactPlan'
import { contactBlocked, contactClicked, contactSucceeded } from '@/modules/leads/contactEvents'

/**
 * Call and WhatsApp — the two first-class mobile contact actions.
 *
 * ── WHATSAPP: IN-APP WHEN WE CAN, THE REP'S OWN WHATSAPP WHEN WE CANNOT ─────
 *
 * Connected (or unknown): resolve the REAL conversation
 * (`resolveLeadWhatsappConversation` → find, else
 * `ensureWhatsappConversationForLead`) and navigate to
 * `/inbox?conversation=<id>`. Same server action the desktop table and the
 * dashboard quick-actions use — no second lookup, no invented conversation.
 * THIS PATH IS UNCHANGED. It is the one contact route in the product that
 * already works end to end, and this component must not disturb it.
 *
 * NOT connected: hand off to WhatsApp itself with this lead's number.
 *
 * WHY THE FALLBACK CAME BACK, AND WHY IT IS SHAPED LIKE THIS. It used to route
 * to `/settings/integrations?section=whatsapp`. In production five businesses
 * tapped this control nine times and produced zero conversations; one of them
 * had just imported two hundred contacts, was sent to that settings page three
 * times, and never started a connection. Asking someone to complete a Meta
 * onboarding before they may phone a lead they already have is a prerequisite we
 * invented, not one Meta imposes.
 *
 * The ORIGINAL fallback was genuinely broken, and this is not it. That one called
 * `window.open(wa.me)` from inside `onUnavailable`, i.e. AFTER an awaited server
 * action had resolved. By then the browser's transient user activation was spent,
 * mobile suppressed the popup, and the FIRST TAP DID NOTHING AT ALL. Here the
 * decision is made SYNCHRONOUSLY at render (`resolveLeadContactPlan`, which does
 * no I/O) and the control is a real `<a href>`: the browser follows it on the
 * first tap, with no gesture to spend. No `window.open`, no await before the
 * navigation. That is the whole difference, and it is load-bearing.
 *
 * `whatsappConnected` undefined means "caller does not know" and resolves to the
 * in-app path, so surfaces that have not been threaded the workspace connection
 * state behave exactly as before.
 *
 * Call is unchanged: `tel:` is a real OS navigation and belongs to the dialer.
 *
 * ANALYTICS. `lead_action_taken` is KEPT so the existing Activation KPI does not
 * break mid-experiment, but it only ever measured INTENT — it fires on tap,
 * before the outcome is known. The contact triad
 * (`lead_contact_clicked` → exactly one of `lead_contact_succeeded` /
 * `lead_contact_blocked`) is what separates intent from result.
 *
 * For the native branch `lead_contact_succeeded { channel: 'whatsapp_native' }`
 * means ONLY that SocialCRM handed the rep to WhatsApp with this number. It does
 * NOT mean a message was written, sent, delivered, or answered — once the anchor
 * is followed the conversation leaves our process entirely.
 *
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
  whatsappConnected,
}: {
  leadId: number
  phone: string | null | undefined
  /** 'row' = icon buttons for list rows; 'bar' = full-width sticky bar buttons. */
  size?: 'row' | 'bar'
  className?: string
  name?: string | null
  /** Workspace WhatsApp connection. Omit when unknown — keeps the in-app path. */
  whatsappConnected?: boolean
}) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  // `waMeHref(phone)` used to widen this guard; it was always derived from
  // `phone`, so dropping it changes nothing about when the action renders.
  if (!phone) return null

  const plan = resolveLeadContactPlan({ phone, whatsappConnected })

  /** In-app path. Unchanged behaviour; the triad is added around it. */
  const openWhatsapp = () => {
    if (busy || pending) return
    setBusy(true)
    recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'message', leadId, via: 'inbox' }).catch(
      () => {},
    )
    contactClicked(leadId, 'mobile', 'whatsapp_api')
    startTransition(async () => {
      try {
        const outcome = await openLeadWhatsappInInbox(leadId, (href) => router.push(href), {
          /**
           * UNCHANGED for callers that do not pass `whatsappConnected`. Those
           * surfaces have not opted into the native fallback, so a workspace with
           * no connection must still land exactly where it did before — the
           * connect UI — rather than silently acquiring new behaviour. Callers
           * that DO know the state never reach this branch: `plan` resolves to
           * `native` for them before the in-app path is ever taken.
           */
          onNoConnection: () => router.push(WHATSAPP_CONNECT_HREF),
          locale: t.locale,
        })
        if (outcome.kind === 'opened') contactSucceeded(leadId, 'mobile', 'whatsapp_api')
        else if (outcome.kind === 'no-connection') contactBlocked(leadId, 'mobile', 'no_connection')
        else if (outcome.kind === 'no-recipient') contactBlocked(leadId, 'mobile', 'no_phone')
        else contactBlocked(leadId, 'mobile', 'no_connection')
      } finally {
        setBusy(false)
      }
    })
  }

  /**
   * Native path. Runs INSIDE the anchor's own click, before the browser follows
   * the href — never awaited, so the navigation is never delayed or gated.
   */
  const onNativeHandoff = () => {
    recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'message', leadId, via: 'inbox' }).catch(
      () => {},
    )
    contactClicked(leadId, 'mobile', 'whatsapp_native')
    contactSucceeded(leadId, 'mobile', 'whatsapp_native')
  }

  /** A number we cannot dial. Block cleanly; never render a malformed wa.me. */
  const onUnusableNumber = () => {
    contactClicked(leadId, 'mobile', 'whatsapp_native')
    contactBlocked(leadId, 'mobile', 'no_phone')
    toast('message', t('leads.contact.noValidPhone'))
  }

  const working = busy || pending
  const waLabel = name ? t('leads.contact.whatsappName', { name }) : t('leads.contact.whatsapp')

  if (size === 'bar') {
    const barClass =
      'press flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-[#25D366] font-medium text-white hover:opacity-90 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {phone && (
          <a
            href={`tel:${phone}`}
            aria-label={name ? t('leads.contact.callName', { name }) : t('leads.contact.call')}
            className='press flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='phone' type='sol' className='size-4 bg-white' />
            <span>{t('leads.contact.call')}</span>
          </a>
        )}
        {plan.kind === 'native' ? (
          <a href={plan.href} onClick={onNativeHandoff} aria-label={waLabel} className={barClass}>
            <Icon name='whatsapp' type='sol' className='size-4 bg-white' />
            <span>{t('leads.contact.whatsapp')}</span>
          </a>
        ) : (
          <button
            type='button'
            onClick={plan.kind === 'blocked' ? onUnusableNumber : openWhatsapp}
            disabled={working}
            aria-label={waLabel}
            className={barClass}
          >
            <Icon
              name={working ? 'spinner' : 'whatsapp'}
              type='sol'
              className={`size-4 bg-white ${working ? 'animate-spin' : ''}`}
            />
            <span>{working ? t('leads.contact.opening') : t('leads.contact.whatsapp')}</span>
          </button>
        )}
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
  const rowClass =
    'press flex size-11 items-center justify-center rounded-full active:bg-[#25D366]/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'

  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      {plan.kind === 'native' ? (
        <a
          href={plan.href}
          onClick={(e) => {
            e.stopPropagation()
            onNativeHandoff()
          }}
          aria-label={waLabel}
          className={rowClass}
        >
          <Icon name='whatsapp' type='sol' className='size-5 bg-[#25D366]' />
        </a>
      ) : (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            if (plan.kind === 'blocked') onUnusableNumber()
            else openWhatsapp()
          }}
          disabled={working}
          aria-label={waLabel}
          className={rowClass}
        >
          <Icon
            name={working ? 'spinner' : 'whatsapp'}
            type='sol'
            className={`size-5 bg-[#25D366] ${working ? 'animate-spin' : ''}`}
          />
        </button>
      )}

      {phone && (
        <a
          href={`tel:${phone}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={name ? t('leads.contact.callName', { name }) : t('leads.contact.call')}
          className='press flex size-11 items-center justify-center rounded-full active:bg-primary-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          <Icon name='phone' type='sol' className='size-5 bg-primary' />
        </a>
      )}
    </div>
  )
}
