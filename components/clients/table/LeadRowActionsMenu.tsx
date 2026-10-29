'use client'

import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'
import { ActionsMenu } from '../funcs'
import { leadRowActions, type LeadActionCode } from './leadActions'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()

  return (
    <ActionsMenu id={id}>
      {client && (
        <div>
          <Btn
            variant='simple'
            size='simple'
            lbl={t('leads.action.open')}
            onClick={() => router.push(`/clients/${client.id}/summary`)}
          />
        </div>
      )}
      {client?.phone && (
        <>
          <div>
            <div className='h-px bg-gray-200 w-full' />
            <Btn variant='simple' size='simple' lbl={t('leads.contact.call')} onClick={() => window.location.href = `tel:${client.phone}`} />
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
      {leadRowActions(client?.status, hasMultipleUsers, t.locale).map(({ code, label }) => (
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
          lbl={t('leads.action.delete')}
          className='text-red-600 hover:bg-red-600'
          onClick={onDelete}
        />
      </div>
    </ActionsMenu>
  )
}
