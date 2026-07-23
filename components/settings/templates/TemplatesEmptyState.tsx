import OnboardingActionCard from '@/components/clients/OnboardingActionCard'

/**
 * Connected-but-no-messages state. Answers what / why / what-next (ux-guidelines
 * §4), reusing `OnboardingActionCard` so it matches every other first-run tile.
 *
 * The CTA is intentionally INERT in Sprint 2 (no onClick/href) — Sprint 3 wires it
 * to the create modal. Rendered as a present-but-inactive button by design.
 */
export default function TemplatesEmptyState() {
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
      />

      <p className='text-sm text-gray-500'>
        רוצים שהמערכת תשיב אוטומטית ללידים חדשים? זה מוגדר ב״מענה אוטומטי״.
      </p>
    </div>
  )
}
