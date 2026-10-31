import OnboardingActionCard from '@/components/clients/OnboardingActionCard'
import { kindCopy } from '@/lib/support/localizedCopy'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The three ways into support, weighted so the eye lands in one place.
 *
 * THE WORDING IS THE FEATURE. Someone whose WhatsApp will not connect
 * recognises themselves in "יש לי תקלה" instantly, where "פתיחת פנייה" would
 * make them classify their own problem before they could ask for help.
 *
 * THE LAYOUT CARRIES THE HIERARCHY. `יש לי תקלה` spans the full width and uses
 * OnboardingActionCard's existing `recommended` treatment; the other two sit
 * below it, side by side, plain. Three equal tiles would make the customer
 * choose before they could act, which ux-guidelines.md §5 forbids — one primary
 * per screen.
 *
 * Reuses the registry-canonical action tile (architecture-rules.md §10). No new
 * card, no new variant, no new tokens.
 */
export default function SupportActions({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  const problem = kindCopy('problem', locale)
  const question = kindCopy('question', locale)
  return (
    <div className='grid gap-3'>
      <OnboardingActionCard
        href='/support/new?kind=problem'
        icon='circle-exclamation'
        tileClass='bg-red-500'
        title={problem.tileTitle}
        description={problem.tileDescription}
        recommended
      />
      <div className='grid gap-3 mobile:grid-cols-1 desktop:grid-cols-2'>
        <OnboardingActionCard
          href='/support/new?kind=question'
          icon='circle-question'
          tileClass='bg-primary'
          title={question.tileTitle}
          description={question.tileDescription}
        />
        <OnboardingActionCard
          href='/support/guides'
          icon='book-open'
          tileClass='bg-gray-700'
          title={t('support.center.guides')}
          description={t('support.center.guidesDescription')}
        />
      </div>
    </div>
  )
}
