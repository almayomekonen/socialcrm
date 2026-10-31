'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import OutcomeControl from '@/components/leads/OutcomeControl'
import { useFloatingMenu } from '@/lib/useFloatingMenu'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

type Props = {
  id: number
  phone?: string | null
  status?: string | null
  nextFollowUpAt?: string | Date | null
  quiet?: boolean
  onCompleted?: () => void
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}

export default function LeadQuickActions({ id, phone, quiet = false, onCompleted, whatsappConnected }: Props) {
  const t = useT()
  // The menu is portalled to <body>, outside every language region.
  const region = useRegionAttrs()
  const router = useRouter()
  const menu = useFloatingMenu()

  return (
    <div className='flex items-center gap-1.5 shrink-0'>
      {phone &&
        (quiet ? (
          <Btn variant='outline' size='icon' icon='phone' aria-label={t('today.actions.call')} onClick={() => (window.location.href = `tel:${phone}`)} />
        ) : (
          <Btn variant='solid' size='small' icon='phone' lbl={t('today.actions.call')} onClick={() => (window.location.href = `tel:${phone}`)} />
        ))}
      <OutcomeControl leadId={id} compact onCompleted={onCompleted} />
      <div ref={menu.wrapRef} className='inline-flex'>
        <Btn variant='outline' size='icon' icon='ellipsis-vertical' aria-label={t('today.actions.more')} onClick={menu.toggle} aria-haspopup='menu' aria-expanded={menu.open} />
        {menu.open &&
          menu.pos &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={menu.menuRef}
              role='menu'
              {...region}
              style={{ position: 'fixed', top: menu.pos.top, left: menu.pos.left, width: menu.pos.width, zIndex: 100000 }}
              className='flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
            >
              {phone && (
                <button
                  type='button'
                  role='menuitem'
                  className='text-start rounded-md px-3 py-2 text-sm hover:bg-gray-50'
                  onClick={() => {
                    menu.close()
                    contactLeadViaWhatsapp({ id, phone }, whatsappConnected, router.push, 'desktop', { locale: t.locale })
                  }}
                >
                  {t('today.actions.whatsapp')}
                </button>
              )}
              <Link href={`/clients/${id}/summary`} className='text-start rounded-md px-3 py-2 text-sm hover:bg-gray-50' onClick={menu.close}>
                {t('today.actions.openLead')}
              </Link>
            </div>,
            document.body,
          )}
      </div>
    </div>
  )
}
