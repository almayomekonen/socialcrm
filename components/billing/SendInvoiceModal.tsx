'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { api } from '@/lib/funcs'
import ModalPop from '@/lib/modals/ModalPop'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { sendInvoiceEmailAction } from '@/actions/billing/send'
import { formatInvoiceNumber } from './funcs'

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
    const result = await api(
      sendInvoiceEmailAction,
      [
        {
          invoiceId: invoice.id,
          leadId: invoice.leadId,
          recipientEmail: trimmed,
          customMessage: customMessage.trim() || undefined,
        },
      ],
      'החשבונית נשלחה',
      'שליחת החשבונית נכשלה',
    )
    setBusy(false)
    if (result && 'success' in result && result.success) {
      onClose()
      router.refresh()
    }
  }

  return (
    <ModalPop open={open} onClose={busy ? () => {} : onClose} pos='middle' className='w-[460px] max-w-[92vw]'>
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
