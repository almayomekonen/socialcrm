import OnboardingActionCard from '@/components/clients/OnboardingActionCard'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Connected-but-no-messages state. Answers what / why / what-next (ux-guidelines
 * §4), reusing `OnboardingActionCard` so it matches every other first-run tile.
 *
 * The CTA opens the create modal when `onCreate` is provided (Sprint 3). With no
 * `onCreate` it renders as a present-but-inert button (the Sprint 2 default).
 */
export default function TemplatesEmptyState({ onCreate }: { onCreate?: () => void }) {
  const t = useT()
  return (
    <div className='grid gap-3'>
      <div>
        <p className='text-base font-medium text-gray-700'>{t('settings.templates.empty.title')}</p>
        <p className='mt-1 text-sm text-gray-500'>
          {t('settings.templates.empty.body')}
        </p>
      </div>

      <OnboardingActionCard
        icon='comment-dots'
        tileClass='bg-primary'
        title={t('settings.templates.empty.cta')}
        description={t('settings.templates.empty.ctaHint')}
        onClick={onCreate}
      />

      <p className='text-sm text-gray-500'>
        {t('settings.templates.empty.autoReply')}
      </p>
    </div>
  )
}
