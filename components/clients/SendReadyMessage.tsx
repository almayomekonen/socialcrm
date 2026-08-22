'use client'

import { useState } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { toast, proToast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import type { Template } from '@/lib/whatsapp/templates/types'
import { sendTemplateToLead } from '@/actions/whatsapp/templates/sendTemplateToLead'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'

/**
 * Lead-profile affordance: send ONE approved ready-made message to THIS lead
 * (RFC §0 R-A). A template message delivers even after the 24-hour window closed,
 * so this is how a rep reaches a cold lead. Only approved templates are passed in
 * (server-gated); the picker cannot show pending/rejected. No bulk, no schedule.
 *
 * The preview shows sample values (`WhatsappMessagePreview`, aria-hidden) — an
 * honest "this is roughly what the lead will see"; the real send resolves the
 * lead's actual name server-side.
 */
export default function SendReadyMessage({
  leadId,
  templates,
  lbl = 'שלח הודעה מוכנה',
  conversationId = null,
}: {
  leadId: number
  templates: Template[]
  lbl?: string
  conversationId?: number | null
}) {
  const [open, setOpen] = useState(false)
  /** Outbound WhatsApp is Tier 3: the refusal is a billing prompt, not a crash. */
  const expired = useAccessDenied()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sending, setSending] = useState(false)

  const selected = templates.find((t) => t.id === selectedId) ?? null

  const close = () => {
    if (sending) return
    setOpen(false)
    setSelectedId(null)
  }

  const handleSend = async () => {
    if (expired) {
      return proToast({
        title: 'שליחת הודעות זמינה עם Pro',
        body: 'חידוש המנוי יחזיר את שליחת ההודעות ללידים.',
        source: 'ready_message_send',
      })
    }
    if (selectedId == null || sending) return
    setSending(true)
    try {
      const res =
        conversationId != null
          ? await sendTemplateToLead(leadId, selectedId, conversationId)
          : await sendTemplateToLead(leadId, selectedId)
      if (res.ok) {
        toast('success', 'ההודעה נשלחה')
        setOpen(false)
        setSelectedId(null)
      } else if ('error' in res) {
        // This repo's TS does not narrow on `.ok`; reach the error via in-operator.
        toast('error', res.error)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Btn
        lbl={lbl}
        icon='paper-plane'
        variant='outline'
        size='small'
        className='w-fit'
        onClick={() => setOpen(true)}
      />

      <ModalPop
        open={open}
        onClose={close}
        labelledBy='send-ready-message-title'
        pos='middle'
        className='w-[min(92vw,640px)]'
      >
        <h2 id='send-ready-message-title' className='mb-1 text-lg font-semibold text-gray-800'>
          שליחת הודעה מוכנה
        </h2>
        <p className='mb-4 text-sm text-gray-500'>בחרו הודעה שאושרה — היא תישלח לליד בוואטסאפ.</p>

        <div className='grid gap-6 md:grid-cols-[1fr_240px]'>
          <fieldset className='grid gap-2'>
            <legend className='sr-only'>הודעות WhatsApp מוכנות לשליחה</legend>
            {templates.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                  selectedId === t.id ? 'border-primary bg-primary-tint/40' : 'border-gray-200'
                }`}
              >
                <input
                  type='radio'
                  name='ready-message'
                  className='mt-1'
                  checked={selectedId === t.id}
                  onChange={() => setSelectedId(t.id)}
                />
                <span className='min-w-0'>
                  <span className='block truncate text-sm font-medium text-gray-800'>{t.displayTitle}</span>
                  <span className='block line-clamp-1 text-sm text-gray-500'>{t.bodyText || '—'}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <p className='mb-1 text-xs text-gray-500'>תצוגה מקדימה</p>
            {selected ? (
              <WhatsappMessagePreview bodyText={selected.bodyText} variables={selected.variables} />
            ) : (
              <p className='rounded-md border border-dashed border-gray-200 p-3 text-sm text-gray-400'>
                בחרו הודעה כדי לראות תצוגה מקדימה
              </p>
            )}
          </div>
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <Btn lbl='ביטול' variant='ghost' size='small' onClick={close} disabled={sending} />
          <Btn
            lbl={sending ? 'שולח…' : 'שלח הודעה'}
            icon='paper-plane'
            size='small'
            onClick={handleSend}
            disabled={selectedId == null || sending}
          />
        </div>
      </ModalPop>
    </>
  )
}
