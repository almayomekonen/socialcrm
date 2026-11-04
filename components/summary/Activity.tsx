import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import LeadNotes from '@/components/leads/LeadNotes'
import type { LeadNote } from '@/lib/leads/leadNotes'

export default function Activity({ clientId, notes, locale = 'he' }: { clientId: string; notes: LeadNote[]; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='xl:p-8'>
      <h1 className='text-2xl font-bold my-4'>{t('leadDetail.activity.title')}</h1>
      <LeadNotes key={clientId} leadId={Number(clientId)} notes={notes} surface='desktop' />
    </div>
  )
}
