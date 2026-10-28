'use client'

import Icon from '@/lib/Icon'
import { HELP_TRIGGER_EDU } from '@/lib/education'
import { useEducation } from './EducationProvider'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * HELP IS NOT A TOUR, AND ITS VISIBILITY IS NOT TOUR ELIGIBILITY.
 *
 * This used to read `toursEnabled`, which conflated two unrelated questions:
 * "may a guided tour auto-run?" and "can the customer ask for help?". When
 * `productAccess.hasAccess` was added to `toursEnabled` — correctly, to stop a
 * tour auto-opening on top of the paywall and standing between a lapsed
 * customer and the renewal path — the Help button silently vanished with it.
 * The customer least able to self-serve lost the way to ask.
 *
 * `surface` is the honest condition: Help is a desktop affordance, and that is
 * the whole of it. Mobile is unchanged — it has never had this button, and
 * `surface` is 'mobile' for the mobile workspace.
 *
 * This cannot resurrect the button where it does not belong. The Topbar that
 * renders it is only reachable on the branch where the real workspace renders,
 * which already excludes NEVER_STARTED, trialExpired and the mobile workspace —
 * three of the four terms `toursEnabled` carries. The single term this drops in
 * practice is `hasAccess`, which is exactly the coupling being undone.
 *
 * `toursEnabled` is untouched and still governs every auto-run path, so no tour
 * starts merely because this button exists.
 */
export default function HelpTrigger() {
  const { openHelp, helpOpen, surface } = useEducation()
  const t = useT()
  if (surface !== 'desktop') return null

  return (
    <button
      type='button'
      data-edu={HELP_TRIGGER_EDU}
      onClick={openHelp}
      aria-label={t('shell.help')}
      aria-expanded={helpOpen}
      aria-haspopup='dialog'
      title={t('shell.help')}
      className={[
        'inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        'border focus:outline-none focus:ring-2 focus:ring-primary',
        helpOpen ? 'bg-gray-900 border-gray-900 hover:bg-gray-800' : 'bg-white border-gray-200 hover:bg-gray-50',
      ].join(' ')}
    >
      <Icon
        name='circle-question'
        type='sol'
        className={`size-3.5 transition-colors duration-150 ${helpOpen ? 'bg-white' : 'bg-primary'}`}
      />
    </button>
  )
}
