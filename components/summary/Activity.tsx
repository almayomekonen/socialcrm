import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default function Activity({ clientId, locale = 'he' }: { clientId: string; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='xl:p-8'>
      <h1 className='text-2xl font-bold my-4'>{t('leadDetail.activity.title')}</h1>
      <div className='text-center py-12 text-gray-400'>
        <p className='text-base'>{t('leadDetail.activity.empty')}</p>
      </div>
    </div>
  )
}
