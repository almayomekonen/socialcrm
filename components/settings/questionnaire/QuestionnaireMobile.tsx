import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { type LiveRouting } from './builderCopy'
import { liveStatusTextIn } from './copyIn'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import QuestionnaireSimulator from './QuestionnaireSimulator'

/**
 * שאלון וואטסאפ on a phone: where it stands, and a way to try it.
 *
 * NOT THE EDITOR. Building a questionnaire is desk work, and a squeezed editor
 * is worse than an honest handoff. The phone shows the live version and whether
 * a draft is waiting, and lets the owner talk to the live questionnaire as a
 * customer would (the same simulator, the same production code).
 *
 * No on/off switch here: whether WhatsApp answers with the questionnaire is
 * still set with SocialCRM, and the מענה אוטומטי switch already stops it.
 */
export default function QuestionnaireMobile({
  liveRevision,
  published,
  hasDraft,
  routing,
  locale = 'he',
}: {
  liveRevision: number | null
  published: BuilderQuestionnaire | null
  hasDraft: boolean
  routing: LiveRouting
  /** The interface language, resolved once by the page (Hebrew by default). */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div className='flex flex-col gap-4 px-4 pb-8 pt-3' {...regionAttrs(locale)}>
      <h1 className='text-lg font-semibold text-ink'>{t('admin.questionnaire.title')}</h1>
      <div className='grid gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-3'>
        <p className='text-sm text-gray-800'>{liveStatusTextIn(liveRevision, routing, t)}</p>
        {hasDraft && <p className='text-sm text-gray-600'>{t('admin.mobile.questionnaire.draft')}</p>}
        <p className='text-sm text-gray-600'>{t('admin.mobile.questionnaire.desktop')}</p>
      </div>
      {published && liveRevision !== null ? (
        <QuestionnaireSimulator model={published} target={{ revision: liveRevision }} translated={locale !== 'he'} />
      ) : (
        <p className='text-sm text-gray-600'>{t('admin.mobile.questionnaire.afterPublish')}</p>
      )}
    </div>
  )
}
