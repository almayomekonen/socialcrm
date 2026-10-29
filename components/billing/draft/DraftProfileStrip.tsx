import type { BillBillingProfileRow } from '@/db/billing/profiles'
import { useT } from '@/lib/i18n/I18nProvider'

/** The draft editor's recipient strip: the lead's billing profile plus the document currency. */
export default function ProfileStrip({ profile, currency }: { profile: BillBillingProfileRow; currency: string }) {
  const t = useT()
  const address = [profile.address, profile.city, profile.zip].filter(Boolean).join(', ')
  return (
    <>
      <p className='text-lg font-semibold text-gray-900'>{profile.legalName?.trim() || '—'}</p>
      <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-base text-gray-600'>
        {profile.taxId?.trim() && <span>{t('billing.editor.recipient.taxId', { taxId: profile.taxId })}</span>}
        {address && (
          <>
            <span className='text-gray-300'>·</span>
            <span>{address}</span>
          </>
        )}
        {profile.email?.trim() && (
          <>
            <span className='text-gray-300'>·</span>
            <span dir='ltr' className='tabular-nums'>
              {profile.email}
            </span>
          </>
        )}
        {profile.phone?.trim() && (
          <>
            <span className='text-gray-300'>·</span>
            <span dir='ltr' className='tabular-nums'>
              {profile.phone}
            </span>
          </>
        )}
        <span className='text-gray-300'>·</span>
        <span>{t('billing.editor.draft.currency', { currency })}</span>
      </div>
    </>
  )
}
