'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import BottomSheet from '@/components/mobile/BottomSheet'
import ConfirmSheet from '@/components/mobile/ConfirmSheet'
import { toast } from '@/lib/toast'
import { deleteLead, type DeleteLeadResult } from '@/actions/clients'
import { blockReasonText } from '@/lib/leads/deleteResult'
import { openLeadWhatsappInInbox, WHATSAPP_CONNECT_HREF } from '@/modules/inbox/client/openLeadWhatsapp'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

function deleteError(res: DeleteLeadResult): string {
  if ('success' in res) return ''
  if (res.reason === 'has_billing') return `לא ניתן למחוק: ${blockReasonText(res.block)}`
  if (res.reason === 'no_permission') return 'אין לך הרשאה למחוק את הליד'
  return 'הליד לא נמצא'
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
}: {
  leadId: number
  name: string
  phone: string | null
  onStatus: () => void
  onFollowUp: () => void
}) {
  const router = useRouter()
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
        פעולות
      </button>

      <BottomSheet open={open} onClose={close} title='פעולות' titleId='lead-overflow'>
        <div className='flex flex-col gap-2'>
          <SheetBtn
            label='שינוי סטטוס'
            onClick={() => {
              setOpen(false)
              onStatus()
            }}
          />
          <SheetBtn
            label='הוספת מעקב'
            onClick={() => {
              setOpen(false)
              onFollowUp()
            }}
          />
          {phone && (
            <SheetBtn
              label='פתיחת שיחה'
              onClick={() => {
                setOpen(false)
                recordLeadActionEvent('lead_action_taken', {
                  surface: 'mobile',
                  action: 'message',
                  leadId,
                  via: 'inbox',
                }).catch(() => {})
                void openLeadWhatsappInInbox(leadId, (href) => router.push(href), {
                  // No WhatsApp connected: route to the connect UI, never out
                  // of the app.
                  onNoConnection: () => router.push(WHATSAPP_CONNECT_HREF),
                })
              }}
            />
          )}
          <SheetBtn
            label='מחיקת ליד'
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
        title='מחיקת ליד'
        msg={`האם למחוק את "${name}"?\nלא ניתן לשחזר את הליד לאחר המחיקה.`}
        confirmLbl='מחק ליד'
        cancelLbl='ביטול'
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true)
          try {
            const res = await deleteLead(leadId)
            if ('success' in res) {
              toast('success', 'הליד נמחק')
              setConfirm(false)
              router.replace('/leads')
              return
            }
            toast('error', deleteError(res))
          } catch {
            toast('error', 'לא הצלחנו למחוק את הליד')
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
