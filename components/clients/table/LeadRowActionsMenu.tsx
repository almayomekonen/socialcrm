'use client'

import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'
import { ActionsMenu } from '../funcs'
import { leadRowActions, type LeadActionCode } from './leadActions'

/**
 * The ⋮ popover for one row. Every entry is dispatched by its action CODE;
 * the visible label never takes part in deciding what a click does.
 */
export default function LeadRowActionsMenu({
  id,
  client,
  hasMultipleUsers,
  whatsappConnected,
  onAction,
  onDelete,
}: {
  id: string
  client: any
  hasMultipleUsers: boolean
  whatsappConnected?: boolean
  onAction: (code: LeadActionCode) => void
  onDelete: () => void
}) {
  const router = useRouter()

  return (
    <ActionsMenu id={id}>
      {client && (
        <div>
          <Btn
            variant='simple'
            size='simple'
            lbl='פתח ליד'
            onClick={() => router.push(`/clients/${client.id}/summary`)}
          />
        </div>
      )}
      {client?.phone && (
        <>
          <div>
            <div className='h-px bg-gray-200 w-full' />
            <Btn variant='simple' size='simple' lbl='התקשר' onClick={() => window.location.href = `tel:${client.phone}`} />
          </div>
          <div>
            <div className='h-px bg-gray-200 w-full' />
            <Btn
              variant='simple'
              size='simple'
              lbl='WhatsApp'
              onClick={() => contactLeadViaWhatsapp(client, whatsappConnected, router.push, 'desktop')}
            />
          </div>
        </>
      )}
      {leadRowActions(client?.status, hasMultipleUsers).map(({ code, label }) => (
        <div key={code}>
          <div className='h-px bg-gray-200 w-full' />
          <Btn variant='simple' size='simple' lbl={label} onClick={() => onAction(code)} />
        </div>
      ))}
      <div>
        <div className='h-px bg-gray-200 w-full' />
        <Btn
          variant='simple'
          size='simple'
          lbl='מחיקה'
          className='text-red-600 hover:bg-red-600'
          onClick={onDelete}
        />
      </div>
    </ActionsMenu>
  )
}
