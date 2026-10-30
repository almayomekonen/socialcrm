'use client'

import Link from 'next/link'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

/**
 * "A fixed questionnaire is answering for you."
 *
 * The settings page below this notice configures the AI agent: reply style,
 * business description, delay. While the questionnaire is the responder, none
 * of that is what the customer receives — and a page that shows an owner
 * controls which do not govern their live behaviour is a page that lies.
 *
 * READ ONLY BY DESIGN. The questionnaire is configured by SocialCRM staff in
 * this phase, so there is nothing here to edit and no control that would
 * pretend otherwise. What the owner keeps is the switch they already have: the
 * master toggle above stops every automatic reply, questionnaire included.
 *
 * Renders nothing at all for everybody else, so no existing page changes.
 *
 * In the Questionnaire Builder rollout the owner CAN change the questionnaire,
 * so the last line points at the Builder instead of at us. Outside it, the
 * notice is exactly what it was.
 */
export default function QuestionnaireModeNotice({ active, builderHref }: { active: boolean; builderHref?: string }) {
  const t = useT()
  const region = useRegionAttrs()
  if (!active) return null

  return (
    <div className='mb-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3' {...region}>
      <p className='text-sm font-medium text-gray-900'>{t('admin.autoResponse.questionnaire.title')}</p>
      <p className='mt-1 text-sm leading-relaxed text-gray-700'>
        {builderHref
          ? t('admin.autoResponse.questionnaire.builderBody')
          : t('admin.autoResponse.questionnaire.staffBody')}
      </p>
      <p className='mt-1 text-sm leading-relaxed text-gray-700'>
        {t('admin.autoResponse.questionnaire.stop')}{' '}
        {builderHref ? (
          <>
            {t('admin.autoResponse.questionnaire.change')}{' '}
            <Link href={builderHref} className='font-medium text-ink underline underline-offset-2'>
              {t('admin.autoResponse.questionnaire.link')}
            </Link>
            .
          </>
        ) : (
          t('admin.autoResponse.questionnaire.contact')
        )}
      </p>
    </div>
  )
}
