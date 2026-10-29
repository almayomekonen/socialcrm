'use client'

import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'

/** The Google Calendar reconnect notice above the grid (moved out of CalendarView; same markup). */
export default function CalendarReauthBanner() {
  const t = useT()
  return (
    <div className='rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-3 flex-wrap sm:flex-nowrap'>
      <Icon
        name='triangle-exclamation'
        type='reg'
        className='size-5 bg-amber-700 mt-0.5 shrink-0'
      />
      <div className='flex-1 min-w-0'>
        <p className='font-medium'>{t('calendar.page.reauth.title')}</p>
        <p className='text-xs mt-0.5'>{t('calendar.page.reauth.body')}</p>
      </div>
      <Btn
        lbl={t('calendar.page.reauth.cta')}
        variant='outline'
        href='/settings/integrations?section=google-calendar'
        size='small'
      />
    </div>
  )
}
