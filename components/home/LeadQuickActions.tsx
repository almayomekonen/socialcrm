'use client'

import { Btn } from '@/lib/btns/Btn'
import { updateLead } from '@/actions/clients'

type Props = { id: number; phone?: string | null; status?: string | null }

export default function LeadQuickActions({ id, phone, status }: Props) {
  const waNumber = phone ? `972${phone.replace(/\D/g, '').replace(/^0/, '')}` : ''

  function bumpToContacted() {
    if (status !== 'new') return
    void updateLead({ id, status: 'contacted' }).catch(() => {})
  }

  return (
    <div className='flex gap-1'>
      {phone && (
        <Btn
          variant='outline'
          size='icon'
          icon='phone'
          onClick={() => {
            bumpToContacted()
            window.location.href = `tel:${phone}`
          }}
        />
      )}
      {phone && (
        <Btn
          variant='outline'
          size='icon'
          icon='whatsapp'
          iconType='reg'
          onClick={() => {
            bumpToContacted()
            window.open(`https://wa.me/${waNumber}`, '_blank')
          }}
        />
      )}
      <Btn variant='soft' size='icon' icon='arrow-left' href={`/clients/${id}/summary`} />
    </div>
  )
}
