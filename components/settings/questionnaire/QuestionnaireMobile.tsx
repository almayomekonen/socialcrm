import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { liveStatusText, type LiveRouting } from './builderCopy'
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
}: {
  liveRevision: number | null
  published: BuilderQuestionnaire | null
  hasDraft: boolean
  routing: LiveRouting
}) {
  return (
    <div className='flex flex-col gap-4 px-4 pb-8 pt-3'>
      <h1 className='text-lg font-semibold text-ink'>שאלון וואטסאפ</h1>
      <div className='grid gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-3'>
        <p className='text-sm text-gray-800'>{liveStatusText(liveRevision, routing)}</p>
        {hasDraft && <p className='text-sm text-gray-600'>יש טיוטה פתוחה שעוד לא פורסמה.</p>}
        <p className='text-sm text-gray-600'>עריכת השאלון ופרסום גרסה חדשה זמינים במחשב.</p>
      </div>
      {published && liveRevision !== null ? (
        <QuestionnaireSimulator model={published} target={{ revision: liveRevision }} />
      ) : (
        <p className='text-sm text-gray-600'>אחרי שיפורסם שאלון, אפשר יהיה לבדוק אותו כאן.</p>
      )}
    </div>
  )
}
