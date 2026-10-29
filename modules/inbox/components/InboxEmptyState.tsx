import ChannelIcon from './ChannelIcon'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Shown in the workspace pane when no conversation is selected. Guides the user
 * to a next action (UX rule: no dead-end empty screens). `locale` comes from the
 * page (Hebrew by default).
 */
export default function InboxEmptyState({ hasConversations, locale = 'he' }: { hasConversations: boolean; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
      <span className='flex size-14 items-center justify-center rounded-full bg-success-bg'>
        <ChannelIcon channel='whatsapp' className='size-6' />
      </span>
      <p className='mt-3 text-base font-medium text-gray-700'>
        {hasConversations ? t('inbox.empty.pickTitle') : t('inbox.empty.noneTitle')}
      </p>
      <p className='mt-1 text-sm text-gray-500'>
        {hasConversations ? t('inbox.empty.pickBody') : t('inbox.empty.noneBody')}
      </p>
    </div>
  )
}
