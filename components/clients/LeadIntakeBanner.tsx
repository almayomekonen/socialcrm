'use client'

import type { IntakeAlert } from '@/lib/automations/connectors/intakeAlerts'

/**
 * A lead source is refusing what arrives — said on the page where the loss is
 * felt, not buried in settings.
 *
 * The `MetaDisconnectedBanner` pattern, reused rather than reinvented: same
 * amber surface, same one-line consequence, same single CTA, same mount point.
 * That component already says "לידים חדשים לא ייכנסו עד שתחבר אותו מחדש" for the
 * other lead source; this is the same sentence for the website form.
 *
 * Server-rendered and STATE-DERIVED, which is the whole requirement: the
 * failure happens when a lead submits the form, often with nobody logged in, so
 * a toast would be missed entirely. There is no dismiss — the condition is the
 * visibility. The next verified delivery resets the streak and the banner
 * disappears on its own, so nothing asks the customer to acknowledge a problem
 * that has already fixed itself.
 *
 * Renders nothing when there is nothing wrong. It never names the automation:
 * the engine was never reached, and sending someone to the automations screen
 * over this would send them to the wrong screen.
 */
export default function LeadIntakeBanner({ alerts }: { alerts: IntakeAlert[] }) {
  const alert = alerts[0]
  if (!alert) return null

  return (
    <div
      role='status'
      aria-live='polite'
      className='mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3'
    >
      <div className='min-w-0'>
        <p className='text-sm font-semibold text-amber-900'>{alert.title}</p>
        <p className='mt-0.5 text-sm text-amber-800'>{alert.short}</p>
      </div>
      {alert.action && (
        <a
          href={alert.action.href}
          className='shrink-0 rounded-md bg-solid px-4 py-2 text-sm font-semibold text-white hover:bg-solid/85'
        >
          {alert.action.label}
        </a>
      )}
    </div>
  )
}
