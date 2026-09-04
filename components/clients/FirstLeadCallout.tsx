'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { recordFirstLeadEvent } from '@/actions/analytics/recordFirstLeadEvent'
import { beginFirstLeadFlow, claimOpenedEvent, endFirstLeadFlow, isFirstLeadFlow } from './firstLeadFlow'

/**
 * One-time "first manual lead" guidance, shown INLINE at the top of the lead
 * summary — never a modal/overlay/tour, so the real lead stays fully usable.
 *
 * One-shot mechanism (two layers):
 *  1. Arrival: the first-run create path routes here with `?firstLead=1` (set ONLY
 *     from LeadsFirstRun, which renders exclusively when the workspace has no leads
 *     — so it means "first lead created NOW"). We begin the flow in a MODULE latch
 *     (firstLeadFlow) and strip the param on mount.
 *  2. Persistence: the module latch — not React state — is the source of truth for
 *     `active`. It survives FollowUpControl's router.refresh() AND any remount of
 *     this component within the same document, so the completion state cannot be
 *     lost. It lives only in the current document's JS runtime, so a browser
 *     refresh / re-login wipes it and the experience never replays.
 *
 * Completion is driven by the EXISTING follow-up state: setting a follow-up via the
 * existing FollowUpControl re-renders the server page with hasFollowUp=true and the
 * callout swaps to its done state — no duplicate follow-up logic.
 */
export default function FirstLeadCallout({
  leadId,
  hasFollowUp,
  children,
}: {
  leadId: number
  hasFollowUp: boolean
  // The follow-up card, passed through so it can wear a subtle emphasis while the
  // first-lead guidance is active. Presentation-only — the card (and its
  // FollowUpControl) is rendered by the server page and is not otherwise touched.
  children?: ReactNode
}) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Begin the flow exactly ONCE per mount (useState initializer runs once, never
  // on re-render), from the arrival param. Doing this per-render would re-begin
  // the flow while the param is still in the URL and could undo an explicit
  // dismiss/finish; doing it once at mount is both correct and remount-safe (on a
  // genuine remount the param is already stripped, so it won't re-begin a flow
  // the user already ended — but a still-open flow persists in the module latch).
  useState(() => {
    if (sp.get('firstLead') === '1') beginFirstLeadFlow(leadId)
    return null
  })

  const [dismissed, setDismissed] = useState(false)

  // Strip the one-shot param on mount → a browser refresh reloads a param-less URL
  // and (with the module wiped by the reload) the callout never replays.
  useEffect(() => {
    if (sp.get('firstLead') !== '1') return
    if (claimOpenedEvent(leadId))
      recordFirstLeadEvent('first_lead_opened', { surface: 'desktop' }).catch(() => {})
    router.replace(pathname, { scroll: false })
    // Run once on mount; do not re-run when params change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = isFirstLeadFlow(leadId)
  const done = active && hasFollowUp

  /**
   * `first_follow_up_set` is NO LONGER emitted here.
   *
   * It moved to `setLeadFollowUp` (actions/leadFollowUp.ts), the one action both
   * this screen's FollowUpControl and the mobile follow-up sheet already call.
   * Emitting from this component made the milestone desktop-only — this file is
   * rendered by the desktop lead-summary route alone — and made it depend on a
   * `?firstLead=1` arrival plus a module latch surviving a router refresh. It
   * fired zero times in production. The server action cannot be reached without
   * a real persisted write, and `trackOncePerAgency` handles idempotency.
   *
   * This component keeps its UX job: the guidance, and the done state below,
   * both still driven by the real `hasFollowUp` prop.
   */

  function finish() {
    endFirstLeadFlow(leadId) // durable: cannot re-show for this lead, even after a remount
  }

  const showCallout = active && !dismissed
  // Emphasis is the guidance phase ONLY: active flow, not dismissed, follow-up not
  // yet set. Derived from the SAME firstLeadFlow state as the callout — no second
  // lifecycle. It clears automatically when hasFollowUp flips true (completion) or
  // when the flow ends (dismiss), because both re-render this component.
  const guidanceActive = showCallout && !done

  return (
    <>
      {showCallout && (
        <div
          role='status'
          dir='rtl'
          className='mb-6 flex items-start gap-3 rounded-lg border border-gray-200 bg-primary-tint px-4 py-3'
        >
          <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-white'>
            <Icon name={done ? 'circle-check' : 'calendar'} type='reg' className='size-4 bg-primary' />
          </span>

          <div className='min-w-0 flex-1'>
            {!done ? (
              <>
                <h2 className='text-sm font-bold text-ink'>הליד הראשון שלך בפנים</h2>
                <p className='mt-0.5 text-sm text-gray-600'>קבע מתי לחזור אליו, ו־SocialCRM ידאג להחזיר אותו אליך בזמן.</p>
              </>
            ) : (
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <p className='text-sm font-semibold text-ink'>מעולה. הליד שלך בטיפול.</p>
                <Btn
                  variant='outline'
                  size='small'
                  lbl='חזרה ללידים'
                  onClick={() => {
                    finish()
                    router.push('/leads')
                  }}
                />
              </div>
            )}
          </div>

          <button
            type='button'
            aria-label='סגירה'
            onClick={() => {
              finish()
              setDismissed(true)
            }}
            className='flex-none rounded p-0.5 text-gray-400 hover:text-gray-600'
          >
            <Icon name='xmark' type='reg' className='size-3.5 bg-gray-400' />
          </button>
        </div>
      )}

      {/* The follow-up card. While the first-lead guidance is active, it wears a
          subtle primary ring so the eye connects the callout's instruction to the
          FollowUpControl action just inside it. Ring is box-shadow-based (no layout
          shift); reduced-motion users get no transition. Ordinary/2nd/dismissed/
          post-follow-up leads render the card with no ring. */}
      <div className={guidanceActive ? 'rounded-lg ring-2 ring-primary/30 motion-safe:transition-shadow' : undefined}>
        {children}
      </div>
    </>
  )
}
