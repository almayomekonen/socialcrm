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
 */
export default function QuestionnaireModeNotice({ active }: { active: boolean }) {
  if (!active) return null

  return (
    <div className='mb-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3'>
      <p className='text-sm font-medium text-gray-900'>שאלון אוטומטי פעיל בוואטסאפ</p>
      <p className='mt-1 text-sm leading-relaxed text-gray-700'>
        הפניות בוואטסאפ נענות כרגע בשאלון קבוע, ולא במענה החכם. השאלון מוגדר עבורכם על ידי צוות SocialCRM, ולכן
        ההגדרות בעמוד הזה אינן משפיעות על מה שהפונים מקבלים.
      </p>
      <p className='mt-1 text-sm leading-relaxed text-gray-700'>
        כדי לעצור את המענה האוטומטי כולו, כבו את המענה האוטומטי למעלה. לשינוי השאלון, פנו אלינו.
      </p>
    </div>
  )
}
