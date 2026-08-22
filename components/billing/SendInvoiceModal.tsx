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

// Map every server-side error reason to a clear Hebrew message. Without
// this, the `api()` helper showed a success toast on EVERY non-thrown
// return — including `{ error: true, reason: 'pdf_not_ready' }` — leaving
// the user thinking the email was sent when it wasn't.
const SEND_ERROR_MESSAGES: Record<SendInvoiceErrorReason, string> = {
  no_permission: 'אין הרשאה לשליחת חשבוניות',
  lead_not_found: 'הליד לא נמצא',
  invoice_not_found: 'החשבונית לא נמצאה',
  invoice_not_issued: 'החשבונית עדיין טיוטה',
  pdf_not_ready: 'קובץ ה-PDF עדיין לא מוכן',
  invalid_email: 'כתובת המייל אינה תקינה',
  rate_limited: 'נשלחה בקשה לאחרונה — נסו שוב בעוד מספר שניות',
  transport_failed: 'שירות המייל סירב — בדקו את הלוגים',
  failed: 'שליחת החשבונית נכשלה',
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
      toast('error', 'שליחת החשבונית נכשלה')
      console.error('[send-modal] threw', err)
      return
    }

    setBusy(false)

    if ('success' in result && result.success) {
      toast('success', 'החשבונית נשלחה')
      onClose()
      router.refresh()
      return
    }

    // Error path — surface the specific reason so the user understands
    // WHY the send didn't happen (was the PDF not ready? is the lead
    // missing? etc.). Previously the api() helper hid this entirely.
    const reason = (result as { reason?: SendInvoiceErrorReason }).reason
    const message = reason ? SEND_ERROR_MESSAGES[reason] : SEND_ERROR_MESSAGES.failed
    toast('error', message)
  }

  if (expired) {
    return (
      <ModalPop open={open} onClose={onClose} label='שליחת חשבונית' pos='middle' className='w-[460px] max-w-[92vw]'>
        <SubscriptionExpiredState mode='panel' source='invoice_send' feature='חידוש המנוי מחזיר את שליחת החשבוניות.' />
      </ModalPop>
    )
  }

  return (
    <ModalPop open={open} onClose={busy ? () => {} : onClose} label='שליחת חשבונית' pos='middle' className='w-[460px] max-w-[92vw]'>
      <div className='grid gap-4 pt-2'>
        <div className='flex items-start gap-3'>
          <div className='size-11 rounded-lg bg-softy border border-soft flex items-center justify-center shrink-0'>
            <img src='/media/fav.svg' alt='SocialCRM' className='size-6' draggable={false} />
          </div>
          <div className='min-w-0'>
            <p className='text-xs text-gray-500'>
              {invoice.kind === 'invoice_receipt' ? 'שליחת חשבונית/קבלה' : 'שליחת חשבונית'}
            </p>
            <h3 className='text-lg font-semibold tabular-nums text-dark leading-tight'>{formatInvoiceNumber(invoice)}</h3>
            <p className='mt-1 text-sm text-gray-600 leading-relaxed'>
              ללקוח יישלח מייל עם קישור להורדת המסמך כקובץ PDF.
            </p>
          </div>
        </div>

        <Input
          name='recipientEmail'
          type='email'
          lbl='לאיזה מייל לשלוח'
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
          {showAdvanced ? 'הסתר אפשרויות נוספות' : 'אפשרויות נוספות'}
        </button>

        {showAdvanced && (
          <Input
            name='customMessage'
            as='textarea'
            lbl='הודעה אישית (אופציונלי)'
            required={false}
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            placeholder='שלום, מצורפת החשבונית. תודה!'
          />
        )}

        <div className='flex justify-end gap-2 mt-2'>
          <Btn variant='outline' lbl='ביטול' onClick={onClose} type='button' disabled={busy} />
          <Btn
            icon='paper-plane'
            lbl='שלח חשבונית'
            onClick={onSend}
            type='button'
            disabled={busy || !isValid}
            title={!isValid ? 'הזן כתובת מייל תקינה' : undefined}
            data-testid='send-invoice-submit'
          />
        </div>
      </div>
    </ModalPop>
  )
}
