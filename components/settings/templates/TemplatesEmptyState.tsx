import OnboardingActionCard from '@/components/clients/OnboardingActionCard'

/**
 * Connected-but-no-messages state. Answers what / why / what-next (ux-guidelines
 * §4), reusing `OnboardingActionCard` so it matches every other first-run tile.
 *
 * The CTA opens the create modal when `onCreate` is provided (Sprint 3). With no
 * `onCreate` it renders as a present-but-inert button (the Sprint 2 default).
 */
export default function TemplatesEmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className='grid gap-3'>
      <div>
        <p className='text-base font-medium text-gray-700'>אין עדיין הודעות מוכנות</p>
        <p className='mt-1 text-sm text-gray-500'>
          הודעות מוכנות מאפשרות לפנות ללידים גם אחרי שהשיחה נרגעה — תזכורת, מבצע או עדכון — בלי להמתין שהליד יכתוב קודם.
        </p>
      </div>

      <OnboardingActionCard
        icon='comment-dots'
        tileClass='bg-primary'
        title='צור הודעה מוכנה'
        description='נסחו הודעה שאפשר לשלוח ללידים בכל זמן'
        onClick={onCreate}
      />

      <p className='text-sm text-gray-500'>
        רוצים שהמערכת תשיב אוטומטית ללידים חדשים? זה מוגדר ב״מענה אוטומטי״.
      </p>
    </div>
  )
}
