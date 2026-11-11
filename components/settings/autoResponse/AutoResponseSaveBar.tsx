'use client'

import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The form's save bar: pinned to the bottom of the viewport, and present only
 * while there is something to save — unsaved changes, or a refused save whose
 * error the owner still needs to read. Otherwise it is not rendered at all, so a
 * settled page shows no idle buttons. A successful save is confirmed by toast
 * (the form), since the bar leaves with the changes.
 *
 * Same bar language as `MobileStickyActions` (sticky, top hairline, white),
 * within the form's content column on desktop. `showError` is the form's own
 * condition: an error that is not already shown under the fixed-message field.
 */
type Props = {
  error: string | null
  showError: boolean
  dirty: boolean
  pending: boolean
  proLocked: boolean
  onCancel: () => void
  onSave: () => void
}

export default function AutoResponseSaveBar({ error, showError, dirty, pending, proLocked, onCancel, onSave }: Props) {
  const t = useT()
  if (!dirty && !error) return null
  return (
    <div
      data-auto-response-save-bar
      className='sticky bottom-0 z-30 mt-5.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-gray-200 bg-white py-3.5 pb-[calc(env(safe-area-inset-bottom,0px)+0.875rem)]'
    >
      <div className='flex min-w-0 items-center gap-2.5'>
        {showError ? (
          <p className='text-sm text-red-600' role='alert'>
            {error}
          </p>
        ) : (
          dirty && (
            <>
              <span className='size-1.25 shrink-0 rounded-full bg-warning' aria-hidden />
              <p className='text-sm text-gray-700'>{t('admin.autoResponse.save.dirty')}</p>
            </>
          )
        )}
      </div>

      {proLocked ? (
        <SubscriptionExpiredState mode='inline' source='auto_response_save' feature={t('admin.autoResponse.expiredFeature')} translated />
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
