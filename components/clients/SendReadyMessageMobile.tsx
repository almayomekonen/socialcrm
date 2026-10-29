'use client'

import { useState } from 'react'
import BottomSheet from '@/components/mobile/BottomSheet'
import { toast, proToast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import type { Template } from '@/lib/whatsapp/templates/types'
import { sendTemplateToLead } from '@/actions/whatsapp/templates/sendTemplateToLead'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'
import { readyMessageTitle } from '@/modules/templates/mobile/readyMessageTitle'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Phone picker for sending one approved ready message.
 *
 * Same `sendTemplateToLead` contract as `SendReadyMessage` — including the
 * optional conversationId so Inbox stays inside the thread. The desktop modal
 * is not rendered here.
 *
 * Its chrome follows the interface language, like `SendReadyMessage` (same
 * `leadDetail.readyMessage.*` sentences); template titles and bodies are data.
 * Used only by the phone inbox's composer.
 */
export default function SendReadyMessageMobile({
  leadId,
  templates,
  lbl,
  conversationId = null,
}: {
  leadId: number
  templates: Template[]
  lbl?: string
  conversationId?: number | null
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  /** Outbound WhatsApp is Tier 3: the refusal is a billing prompt, not a crash. */
  const expired = useAccessDenied()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sending, setSending] = useState(false)

  const selected = templates.find((tpl) => tpl.id === selectedId) ?? null

  const close = () => {
    if (sending) return
    setOpen(false)
    setSelectedId(null)
  }

  const handleSend = async () => {
    if (expired) {
      return proToast({
        title: t('leadDetail.readyMessage.proTitle'),
        body: t('leadDetail.readyMessage.proBody'),
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
        toast('success', t('leadDetail.readyMessage.sent'))
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
        {lbl ?? t('leadDetail.readyMessage.open')}
      </button>

      <BottomSheet open={open} onClose={close} title={t('leadDetail.readyMessage.title')} titleId='send-ready-message-title' translated>
        <p className='mb-3 text-sm text-gray-500'>{t('leadDetail.readyMessage.intro')}</p>

        <fieldset className='grid gap-2'>
          <legend className='sr-only'>{t('leadDetail.readyMessage.legend')}</legend>
          {templates.map((tpl) => (
            <label
              key={tpl.id}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${
                selectedId === tpl.id ? 'border-primary bg-primary-tint/40' : 'border-gray-200'
              }`}
            >
              <input
                type='radio'
                name='ready-message'
                className='mt-1 size-4'
                checked={selectedId === tpl.id}
                onChange={() => setSelectedId(tpl.id)}
              />
              <span className='min-w-0'>
                <span className='block truncate text-[15px] font-medium text-ink'>{readyMessageTitle(tpl.displayTitle, t.locale)}</span>
                <span className='mt-0.5 block line-clamp-2 text-sm text-gray-500'>{tpl.bodyText || '—'}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className='mt-4'>
          <p className='mb-1.5 text-sm text-gray-500'>{t('leadDetail.readyMessage.preview')}</p>
          {selected ? (
            <WhatsappMessagePreview bodyText={selected.bodyText} variables={selected.variables} />
          ) : (
            <p className='rounded-md border border-dashed border-gray-200 p-3 text-sm text-gray-400'>
              {t('leadDetail.readyMessage.previewEmpty')}
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
            {sending ? t('leadDetail.readyMessage.sending') : t('leadDetail.readyMessage.send')}
          </button>
          <button
            type='button'
            onClick={close}
            disabled={sending}
            className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            {t('common.dialog.cancel')}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
