'use client'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { FormField } from '@/lib/form'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'

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
}: {
  pendingPhones: Phone[]
  notice: Notice | null
  loading: boolean
  onConnect: (phone: Phone) => void
}) {
  const [selectedPhoneId, setSelectedPhoneId] = useState('')
  const selected = pendingPhones.find((p) => p.id === selectedPhoneId)
  return (
    <div className='grid gap-4'>
      {notice && <ConnectionNotice notice={notice} />}
      <p className='text-sm text-gray-600'>בחר את מספר הטלפון שברצונך לחבר:</p>
      <FormField lbl='מספר וואטסאפ עסקי'>
        <select
          className='h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'
          value={selectedPhoneId}
          onChange={(e) => setSelectedPhoneId(e.target.value)}
        >
          <option value=''>בחר מספר...</option>
          {pendingPhones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayPhone} — {p.verifiedName}
            </option>
          ))}
        </select>
      </FormField>
      <div data-edu='whatsapp-connect' className='w-fit'>
      <Btn
        lbl={loading ? 'מחבר...' : (notice?.action ?? 'חבר וואטסאפ')}
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
