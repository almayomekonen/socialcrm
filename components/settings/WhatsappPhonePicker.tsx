'use client'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

export type Phone = { id: string; displayPhone: string; verifiedName: string }

/**
 * WhatsApp State B (split from WhatsappConnect): Meta returned the business
 * numbers, the user picks one to connect. Display data only.
 */
export default function WhatsappPhonePicker({
  pendingPhones,
  notice,
  loading,
  onConnect,
  translated = false,
}: {
  pendingPhones: Phone[]
  notice: Notice | null
  loading: boolean
  onConnect: (phone: Phone) => void
  /** Follow the interface language (WhatsappConnect's `translated`). */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const [selectedPhoneId, setSelectedPhoneId] = useState('')
  const selected = pendingPhones.find((p) => p.id === selectedPhoneId)
  return (
    <div className='grid gap-4'>
      {notice && <ConnectionNotice notice={notice} reasonsLabel={t('settings.integrations.reasonsLabel')} />}
      <p className='text-sm text-gray-600'>{t('settings.integrations.whatsapp.pickPhone')}</p>
      <FormField lbl={t('settings.integrations.whatsapp.phoneLabel')}>
        <select
          className='h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'
          value={selectedPhoneId}
          onChange={(e) => setSelectedPhoneId(e.target.value)}
        >
          <option value=''>{t('settings.integrations.whatsapp.phonePlaceholder')}</option>
          {pendingPhones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayPhone} — {p.verifiedName}
            </option>
          ))}
        </select>
      </FormField>
      <div data-edu='whatsapp-connect' className='w-fit'>
      <Btn
        lbl={loading ? t('settings.integrations.whatsapp.connectingPhone') : (notice?.action ?? t('settings.integrations.whatsapp.connectPhone'))}
        icon={loading ? 'spinner' : 'comment-dots'}
        iconClassName={loading ? 'animate-spin' : undefined}
        size='medium'
        disabled={!selectedPhoneId || loading}
        className='w-fit'
        onClick={() => selected && onConnect(selected)}
      />
      </div>
    </div>
  )
}
