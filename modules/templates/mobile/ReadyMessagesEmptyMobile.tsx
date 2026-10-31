'use client'

import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'

export default function ReadyMessagesEmptyMobile({ onCreate }: { onCreate: () => void }) {
  const t = useT()
  return (
    <div className='rounded-xl border border-gray-200 bg-white p-5'>
      <p className='text-base font-semibold text-ink'>{t('settings.mobile.ready.emptyTitle')}</p>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
        {t('settings.mobile.ready.emptyBody')}
      </p>
      <button
        type='button'
        onClick={onCreate}
        className='press mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon name='plus' type='sol' className='size-4 bg-white' />
        {t('settings.mobile.status.rm.create')}
      </button>
    </div>
  )
}
