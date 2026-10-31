'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import BottomSheet from '@/components/mobile/BottomSheet'
import ConfirmSheet from '@/components/mobile/ConfirmSheet'
import { toast } from '@/lib/toast'
import { deleteLead, type DeleteLeadResult } from '@/actions/clients'
import { blockReasonText } from '@/lib/leads/deleteResult'
import { WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'

function deleteError(res: DeleteLeadResult, t: Translator): string {
  if ('success' in res) return ''
  if (res.reason === 'has_billing') return t('leads.mobile.detail.cannotDelete', { reason: blockReasonText(res.block, t.locale) })
  if (res.reason === 'no_permission') return t('leads.mobile.detail.noPermission')
  return t('leads.mobile.detail.notFound')
}

/**
 * ⋯ פעולות for mobile lead detail. Opens existing sheets / mutations.
 * There is no mobile lead-edit form (desktop ClientFormPop) — not invented here.
 */
export default function LeadOverflowSheet({
  leadId,
  name,
  phone,
  onStatus,
  onFollowUp,
  whatsappConnected,
}: {
  leadId: number
  name: string
  phone: string | null
  onStatus: () => void
  onFollowUp: () => void
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const router = useRouter()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (busy) return
    setOpen(false)
  }

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white text-[13px] font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon name='ellipsis' type='sol' className='size-3.5 bg-gray-600' />
        {t('leads.mobile.sheet.actions')}
      </button>

      <BottomSheet open={open} onClose={close} title={t('leads.mobile.sheet.actions')} titleId='lead-overflow' translated>
        <div className='flex flex-col gap-2'>
          <SheetBtn
            label={t('leads.mobile.sheet.changeStatus')}
            onClick={() => {
              setOpen(false)
              onStatus()
            }}
          />
          <SheetBtn
            label={t('leads.mobile.sheet.addFollowUp')}
            onClick={() => {
              setOpen(false)
              onFollowUp()
            }}
          />
          {phone && (
            <SheetBtn
              label={t('leads.mobile.sheet.openChat')}
              onClick={() => {
                setOpen(false)
                recordLeadActionEvent('lead_action_taken', {
                  surface: 'mobile',
                  action: 'message',
                  leadId,
                  via: 'inbox',
                }).catch(() => {})
                contactLeadViaWhatsapp({ id: leadId, phone }, whatsappConnected, (href) => router.push(href), 'mobile', {
                  // Unchanged for callers that do not know the connection state.
                  onNoConnection: () => router.push(WHATSAPP_CONNECT_HREF),
                  locale: t.locale,
                })
              }}
            />
          )}
          <SheetBtn
            label={t('leads.mobile.sheet.deleteLead')}
            danger
            onClick={() => {
              setOpen(false)
              setConfirm(true)
            }}
          />
        </div>
      </BottomSheet>

      <ConfirmSheet
        open={confirm}
        destructive
        title={t('leads.mobile.confirm.titleOne')}
        msg={t('leads.mobile.confirm.msgOne', { name })}
        confirmLbl={t('leads.mobile.confirm.deleteOne')}
        cancelLbl={t('common.dialog.cancel')}
        translated
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true)
          try {
            const res = await deleteLead(leadId)
            if ('success' in res) {
              toast('success', t('leads.dialog.deleted'))
              setConfirm(false)
              router.replace('/leads')
              return
            }
            toast('error', deleteError(res, t))
          } catch {
            toast('error', t('leads.mobile.detail.deleteFailed'))
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

function SheetBtn({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`press flex min-h-11 w-full items-center justify-center rounded-md font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        danger
          ? 'border border-red-200 bg-white text-red-700 hover:bg-red-50'
          : 'border border-gray-200 bg-white text-ink hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )
}
