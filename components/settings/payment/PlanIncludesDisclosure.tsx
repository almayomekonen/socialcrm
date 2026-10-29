import Icon from '@/lib/Icon'
import { PRO_INCLUDED } from '@/lib/plans'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { planIncluded } from './planCopy'

/**
 * "מה כלול במסלול Pro" — the quiet disclosure that replaced the חבילות
 * comparison section.
 *
 * A subscriber occasionally wants to check what they are paying for; they do
 * not need a pricing table to do it. Native <details> so it works without
 * JavaScript and stays a Server Component, and deliberately NOT AccordionItem:
 * that component draws a full-width bordered row with its own hover surface,
 * which is right for a page section and far too loud for a link inside a card.
 */
export default function PlanIncludesDisclosure({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <details className='group/inc'>
      <summary className='flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm text-solid [&::-webkit-details-marker]:hidden'>
        <Icon
          name='chevron-down'
          type='reg'
          className='size-3 bg-solid transition-transform duration-200 group-open/inc:rotate-180'
        />
        {t('settings.payment.plan.includes')}
      </summary>
      <ul className='mt-2.5 space-y-1.5'>
        {planIncluded(PRO_INCLUDED, t).map((item) => (
          <li key={item} className='flex items-start gap-2 text-sm text-gray-600'>
            <Icon name='check' type='reg' className='mt-0.5 size-3.5 shrink-0 bg-gray-400' />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
