'use client'

import { useState } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'
import { toast } from '@/lib/toast'
import type { Template } from '@/lib/whatsapp/templates/types'
import { sendTemplateToLead } from '@/actions/whatsapp/templates/sendTemplateToLead'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'

/**
 * Phone picker for sending one approved ready message.
 *
 * Same `sendTemplateToLead` contract as `SendReadyMessage` — including the
 * optional conversationId so Inbox stays inside the thread. The desktop modal
 * is not rendered here.
 */
export default function SendReadyMessageMobile({
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
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sending, setSending] = useState(false)

  const selected = templates.find((t) => t.id === selectedId) ?? null

  const close = () => {
    if (sending) return
    setOpen(false)
    setSelectedId(null)
  }

  const handleSend = async () => {
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
        toast('error', res.error)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div data-testid='send-ready-message-mobile'>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {lbl}
      </button>

      <BottomSheet open={open} onClose={close} title='שליחת הודעה מוכנה' titleId='send-ready-message-title'>
        <p className='mb-3 text-sm text-gray-500'>בחרו הודעה שאושרה — היא תישלח לליד בוואטסאפ.</p>

        <fieldset className='grid gap-2'>
          <legend className='sr-only'>הודעות WhatsApp מוכנות לשליחה</legend>
          {templates.map((t) => (
            <label
              key={t.id}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${
                selectedId === t.id ? 'border-primary bg-primary-tint/40' : 'border-gray-200'
              }`}
            >
              <input
                type='radio'
                name='ready-message'
                className='mt-1 size-4'
                checked={selectedId === t.id}
                onChange={() => setSelectedId(t.id)}
              />
              <span className='min-w-0'>
                <span className='block truncate text-[15px] font-medium text-ink'>{t.displayTitle}</span>
                <span className='mt-0.5 block line-clamp-2 text-sm text-gray-500'>{t.bodyText || '—'}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className='mt-4'>
          <p className='mb-1.5 text-sm text-gray-500'>תצוגה מקדימה</p>
          {selected ? (
            <WhatsappMessagePreview bodyText={selected.bodyText} variables={selected.variables} />
          ) : (
            <p className='rounded-md border border-dashed border-gray-200 p-3 text-sm text-gray-400'>
              בחרו הודעה כדי לראות תצוגה מקדימה
            </p>
          )}
        </div>

        <div className='mt-4 flex flex-col gap-2'>
          <button
            type='button'
            onClick={handleSend}
            disabled={selectedId == null || sending}
            className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            {sending ? 'שולח…' : 'שלח הודעה'}
          </button>
          <button
            type='button'
            onClick={close}
            disabled={sending}
            className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            ביטול
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
