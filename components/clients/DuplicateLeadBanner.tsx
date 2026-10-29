'use client'

import type { DuplicateMatch, DuplicateSignal } from '@/lib/leads/duplicateMatch'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { leadStatusFormLabel } from '@/lib/leads/statusStyles'

const SIGNAL_KEY: Record<DuplicateSignal, MessageKey> = {
  idNum: 'leads.duplicate.signal.idNum',
  phone: 'leads.duplicate.signal.phone',
  email: 'leads.duplicate.signal.email',
}

/**
 * Advisory banner shown when an entered phone/email/idNum looks like an existing
 * lead. Purely informational — it never blocks the form; the user can always
 * continue and save. Styling mirrors the existing inline banners
 * (OverQuotaBanner / LeadStatusNudge): amber for a likely match, blue for a softer one.
 */
export default function DuplicateLeadBanner({
  matches,
  onDismiss,
}: {
  matches: DuplicateMatch[]
  onDismiss: () => void
}) {
  const t = useT()
  if (!matches.length) return null
  const isStrong = matches.some((m) => m.confidence === 'certain')

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 ${
        isStrong ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50/60'
      }`}
    >
      <div className='flex items-start justify-between gap-3'>
        <p className={`text-sm font-semibold ${isStrong ? 'text-amber-900' : 'text-blue-900'}`}>
          {isStrong ? t('leads.duplicate.strong') : t('leads.duplicate.soft')}
        </p>
        <button type='button' onClick={onDismiss} className='shrink-0 text-xs text-gray-500 hover:text-gray-700'>
          {t('leads.duplicate.hide')}
        </button>
      </div>

      <ul className='mt-2 grid gap-2'>
        {matches.map((m) => (
          <li key={m.id} className='rounded-md border border-gray-200 bg-white px-3 py-2 text-sm'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-medium text-gray-900'>{m.name || t('leads.duplicate.unnamed')}</span>
              {m.status && <span className='text-xs text-gray-500'>{leadStatusFormLabel(m.status, t.locale) ?? m.status}</span>}
            </div>
            {(m.phone || m.email) && (
              <div className='mt-0.5 text-xs text-gray-500'>{[m.phone, m.email].filter(Boolean).join(' · ')}</div>
            )}
            <div className='mt-1 text-xs text-gray-600'>{m.signals.map((s) => t(SIGNAL_KEY[s])).join(' · ')}</div>
          </li>
        ))}
      </ul>

      <p className={`mt-2 text-xs ${isStrong ? 'text-amber-800' : 'text-blue-800'}`}>
        {t('leads.duplicate.hint')}
      </p>
    </div>
  )
}
