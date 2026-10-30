'use client'

import { useState } from 'react'
import { api } from '@/lib/funcs'
import ModalPop from '@/lib/modals/ModalPop'
import IssuerIdentityForm from './IssuerIdentityForm'
import { fieldsByTier, type IssuerData } from '@/lib/billing/issuer/fields'
import { updateIssuerIdentityAction } from '@/actions/billing/issuer'
import { useT } from '@/lib/i18n/I18nProvider'
import { localizeIssuerFields } from './localizedFields'

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
  const t = useT()
  const [busy, setBusy] = useState(false)

  async function handleSubmit(values: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    const result = await api(
      updateIssuerIdentityAction,
      [values],
      undefined,
      t('billing.issuer.saveFailed'),
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
      label={t('billing.issuer.dialogLabel')}
      className='w-[520px] max-w-[92vw]'
      translated
    >
      <div className='pt-2 grid gap-5'>
        <header className='grid gap-1.5'>
          <h2 className='text-xl font-bold text-dark'>{t('billing.issuer.heading')}</h2>
          <p className='text-sm text-gray-600 leading-relaxed'>
            {t('billing.issuer.intro')}
          </p>
        </header>

        <IssuerIdentityForm
          fields={localizeIssuerFields(fieldsByTier([1]), t.locale)}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitLabel={t('billing.issuer.submit')}
          busy={busy}
          cancelLabel={t('common.dialog.cancel')}
          onCancel={onCancel}
          translated
        />
      </div>
    </ModalPop>
  )
}
