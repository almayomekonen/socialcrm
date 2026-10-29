'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { toast } from '@/lib/toast'
import ModalPop from '@/lib/modals/ModalPop'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { sendInvoiceEmailAction, type SendInvoiceErrorReason, type SendInvoiceResult } from '@/actions/billing/send'
import { formatInvoiceNumber } from './funcs'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

// Map every server-side error reason to a clear message (catalog:
// `billing.send.error.*`, worded in the interface language). Without
// this, the `api()` helper showed a success toast on EVERY non-thrown
// return — including `{ error: true, reason: 'pdf_not_ready' }` — leaving
// the user thinking the email was sent when it wasn't.
const SEND_ERROR_KEYS: Record<SendInvoiceErrorReason, MessageKey> = {
  no_permission: 'billing.send.error.no_permission',
  lead_not_found: 'billing.send.error.lead_not_found',
  invoice_not_found: 'billing.send.error.invoice_not_found',
  invoice_not_issued: 'billing.send.error.invoice_not_issued',
  pdf_not_ready: 'billing.send.error.pdf_not_ready',
  invalid_email: 'billing.send.error.invalid_email',
  rate_limited: 'billing.send.error.rate_limited',
  transport_failed: 'billing.send.error.transport_failed',
  failed: 'billing.send.error.failed',
}

export default function SendInvoiceModal({
  invoice,
  fallbackEmail,
  open,
  onClose,
}: {
  invoice: BillInvoiceRow
  fallbackEmail?: string | null
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const router = useRouter()
  /**
   * PRE-GATE inside the modal, so BOTH triggers — SendInvoiceBtn and the
   * post-issue banner — are covered by one gate and no send is ever
   * dispatched. `sendInvoiceEmailAction` is requireProductAccess-guarded; its
   * refusal previously surfaced as "שליחת החשבונית נכשלה".
   */
  const expired = useAccessDenied()
  const [recipient, setRecipient] = useState(
    invoice.emailSnapshot?.trim() || fallbackEmail?.trim() || '',
  )
  const [customMessage, setCustomMessage] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)

  const trimmed = recipient.trim()
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)

  async function onSend() {
    if (busy || !isValid) return
    setBusy(true)
    toast('loading')

    let result: SendInvoiceResult
    try {
      result = await sendInvoiceEmailAction({
        invoiceId: invoice.id,
        leadId: invoice.leadId,
        recipientEmail: trimmed,
        customMessage: customMessage.trim() || undefined,
      })
    } catch (err) {
      setBusy(false)
      toast('error', t(SEND_ERROR_KEYS.failed))
      console.error('[send-modal] threw', err)
      return
    }

    setBusy(false)

    if ('success' in result && result.success) {
      toast('success', t('billing.send.sent'))
      onClose()
      router.refresh()
      return
    }

    // Error path — surface the specific reason so the user understands
    // WHY the send didn't happen (was the PDF not ready? is the lead
    // missing? etc.). Previously the api() helper hid this entirely.
    const reason = (result as { reason?: SendInvoiceErrorReason }).reason
    const message = t(reason ? SEND_ERROR_KEYS[reason] : SEND_ERROR_KEYS.failed)
    toast('error', message)
  }

  if (expired) {
    return (
      <ModalPop open={open} onClose={onClose} label={t('billing.send.title')} pos='middle' className='w-[460px] max-w-[92vw]' translated>
        <SubscriptionExpiredState mode='panel' source='invoice_send' feature={t('billing.send.expired')} translated />
      </ModalPop>
    )
  }

  return (
    <ModalPop open={open} onClose={busy ? () => {} : onClose} label={t('billing.send.title')} pos='middle' className='w-[460px] max-w-[92vw]' translated>
      <div className='grid gap-4 pt-2'>
        <div className='flex items-start gap-3'>
          <div className='size-11 rounded-lg bg-softy border border-soft flex items-center justify-center shrink-0'>
            <img src='/media/fav.svg' alt='SocialCRM' className='size-6' draggable={false} />
          </div>
          <div className='min-w-0'>
            <p className='text-xs text-gray-500'>
              {invoice.kind === 'invoice_receipt' ? t('billing.send.kind.invoice_receipt') : t('billing.send.kind.invoice')}
            </p>
            <h3 className='text-lg font-semibold tabular-nums text-dark leading-tight'>{formatInvoiceNumber(invoice, t.locale)}</h3>
            <p className='mt-1 text-sm text-gray-600 leading-relaxed'>
              {t('billing.send.intro')}
            </p>
          </div>
        </div>

        <Input
          name='recipientEmail'
          type='email'
          lbl={t('billing.send.recipient')}
          dir='ltr'
          required
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder='client@example.com'
          data-testid='send-invoice-recipient'
        />

        <button
          type='button'
          className='self-start text-sm text-solid hover:underline underline-offset-2'
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? t('billing.send.hideAdvanced') : t('billing.send.showAdvanced')}
        </button>

        {showAdvanced && (
          <Input
            name='customMessage'
            as='textarea'
            lbl={t('billing.send.message')}
            required={false}
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            placeholder={t('billing.send.messagePlaceholder')}
          />
        )}

        <div className='flex justify-end gap-2 mt-2'>
          <Btn variant='outline' lbl={t('common.dialog.cancel')} onClick={onClose} type='button' disabled={busy} />
          <Btn
            icon='paper-plane'
            lbl={t('billing.send.submit')}
            onClick={onSend}
            type='button'
            disabled={busy || !isValid}
            title={!isValid ? t('billing.send.invalidEmail') : undefined}
            data-testid='send-invoice-submit'
          />
        </div>
      </div>
    </ModalPop>
  )
}
