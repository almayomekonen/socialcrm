'use client'

import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The form's bottom bar: the inline save state (error / unsaved / saved) and
 * the cancel + save buttons, or the expired lock in their place.
 *
 * Extracted from `AutoResponseSettingsForm.tsx` (328 lines, over the 250-line
 * soft limit — architecture-rules §1, §5) before its translation. The markup
 * moved intact; `showError` is the form's own condition (an error that is not
 * already shown under the fixed-message field).
 */
type Props = {
  error: string | null
  showError: boolean
  dirty: boolean
  saved: boolean
  pending: boolean
  proLocked: boolean
  onCancel: () => void
  onSave: () => void
}

export default function AutoResponseSaveBar({ error, showError, dirty, saved, pending, proLocked, onCancel, onSave }: Props) {
  const t = useT()
  return (
    <div className='mt-5.5 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-5.5'>
      <div className='flex items-center gap-2.5'>
        {showError && (
          <p className='text-sm text-red-600' role='alert'>
            {error}
          </p>
        )}
        {!error && dirty && (
          <>
            <span className='size-1.25 rounded-full bg-warning' />
            <p className='text-sm text-gray-500'>{t('admin.autoResponse.save.dirty')}</p>
          </>
        )}
        {!error && !dirty && saved && <p className='text-sm text-gray-500'>{t('admin.autoResponse.save.saved')}</p>}
      </div>

      {proLocked ? (
        <SubscriptionExpiredState
          mode='inline'
          source='auto_response_save'
          feature={t('admin.autoResponse.expiredFeature')}
          translated
        />
      ) : (
        <div className='flex items-center gap-2.5'>
          <Btn variant='outline' lbl={t('admin.autoResponse.save.cancel')} disabled={!dirty || pending} onClick={onCancel} />
          <Btn
            lbl={pending ? t('admin.autoResponse.save.saving') : t('admin.autoResponse.save.save')}
            icon={pending ? 'spinner' : undefined}
            iconClassName={pending ? 'animate-spin' : undefined}
            disabled={pending}
            onClick={onSave}
          />
        </div>
      )}
    </div>
  )
}
