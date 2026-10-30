'use client'

import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { Btn } from '@/lib/btns/Btn'

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
            <p className='text-sm text-gray-500'>יש שינויים שלא נשמרו</p>
          </>
        )}
        {!error && !dirty && saved && <p className='text-sm text-gray-500'>השינויים נשמרו</p>}
      </div>

      {proLocked ? (
        <SubscriptionExpiredState
          mode='inline'
          source='auto_response_save'
          feature='חידוש המנוי מחזיר את המענה האוטומטי'
        />
      ) : (
        <div className='flex items-center gap-2.5'>
          <Btn variant='outline' lbl='ביטול' disabled={!dirty || pending} onClick={onCancel} />
          <Btn
            lbl={pending ? 'שומר…' : 'שמור שינויים'}
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
