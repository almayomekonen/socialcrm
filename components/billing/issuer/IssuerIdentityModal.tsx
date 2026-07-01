'use client'

import { useState } from 'react'
import { api } from '@/lib/funcs'
import ModalPop from '@/lib/modals/ModalPop'
import IssuerIdentityForm from './IssuerIdentityForm'
import { fieldsByTier, type IssuerData } from '@/lib/billing/issuer/fields'
import { updateIssuerIdentityAction } from '@/actions/billing/issuer'

export default function IssuerIdentityModal({
  open,
  initialValues,
  onSavedAndContinue,
  onCancel,
}: {
  open: boolean
  initialValues: Partial<IssuerData>
  onSavedAndContinue: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function handleSubmit(values: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    const result = await api(
      updateIssuerIdentityAction,
      [values],
      undefined,
      'שמירת פרטי העסק נכשלה',
      { silentSuccess: true },
    )
    setBusy(false)
    if (result && 'success' in result && result.success) {
      onSavedAndContinue()
    }
  }

  return (
    <ModalPop
      open={open}
      pos='middle'
      onClose={busy ? () => {} : onCancel}
      label='פרטי העסק'
      className='w-[520px] max-w-[92vw]'
    >
      <div className='pt-2 grid gap-5'>
        <header className='grid gap-1.5'>
          <h2 className='text-xl font-bold text-dark'>לפני שמנפיקים את החשבונית הראשונה</h2>
          <p className='text-sm text-gray-600 leading-relaxed'>
            צריך להשלים כמה פרטים חד-פעמיים על העסק. זה לוקח רק כמה שניות, ויופיע על כל החשבוניות שתנפיקו.
          </p>
        </header>

        <IssuerIdentityForm
          fields={fieldsByTier([1])}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitLabel='שמור והמשך'
          busy={busy}
          cancelLabel='ביטול'
          onCancel={onCancel}
        />
      </div>
    </ModalPop>
  )
}
