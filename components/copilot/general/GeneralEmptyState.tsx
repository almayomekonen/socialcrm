'use client'

import Icon from '@/lib/Icon'

/**
 * The resting state of the assistant before the first message.
 *
 * It is NOT a "you have no leads" notice. The assistant is a business assistant,
 * not a lead assistant: it is available and answerable with whatever context the
 * workspace currently has, so this state announces readiness, never a missing
 * prerequisite. Copy must never imply the assistant is unavailable, locked, or
 * "unlocked by" adding leads — a data-dependent question is answered (or honestly
 * declined) by the backend at ask time, not pre-empted by this screen.
 *
 * It carries NO calls to action. The composer below is the only interaction here,
 * and anything competing with it pulls the user out of the conversation the panel
 * exists to start. Adding leads has its own dedicated surfaces (/leads first run,
 * settings) and does not need a second entry point inside the assistant.
 *
 * Layout follows the sibling `components/copilot/primitives/EmptyTimelineState`
 * — same centered column, same `sparkles` mark, same muted scale — so the two
 * copilot surfaces read as one product. No new visual language.
 *
 * ARCHITECTURE (unchanged, do not regress): `hasAnyLeads` (surfaced as
 * `briefing.kind === 'empty'`) decides what renders INSIDE the panel; it never
 * decides whether the panel is usable. The composer stays mounted alongside this
 * state. This is also distinct from `kind === 'locked'`, an ENTITLEMENT state
 * owned by SubscriptionExpiredState in the panel body; the two are never collapsed.
 *
 * `onDataChanged` is still accepted because GeneralModePanel passes it. It is
 * unused now that this state neither creates nor imports data; dropping it would
 * mean editing the panel, which this change deliberately leaves untouched.
 */
export default function GeneralEmptyState(_props: { onDataChanged?: () => void }) {
  return (
    <div className='flex h-full select-none flex-col items-center justify-center gap-4 px-6 text-center'>
      <Icon name='sparkles' type='reg' className='size-6 bg-gray-300' />

      <div className='space-y-1'>
        <p className='text-sm font-semibold text-gray-800'>העוזר העסקי שלך מוכן</p>
        <p className='mx-auto max-w-60 text-xs leading-relaxed text-gray-500'>
          אפשר לשאול כל דבר על העסק, על המכירות, או איך להשתמש ב־SocialCRM.
        </p>
      </div>
    </div>
  )
}
