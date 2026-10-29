'use client'

import { useState } from 'react'
import { api } from '@/lib/funcs'
import IssuerIdentityForm from '@/components/billing/issuer/IssuerIdentityForm'
import { fieldsByTier, type IssuerData } from '@/lib/billing/issuer/fields'
import { updateIssuerIdentityAction } from '@/actions/billing/issuer'
import { useT } from '@/lib/i18n/I18nProvider'
import { localizeIssuerFields } from '@/components/billing/issuer/localizedFields'


export default function EditAgency({ issuer }: { issuer: IssuerData }) {
  const t = useT()
  const [busy, setBusy] = useState(false)

  async function handleSubmit(values: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    await api(updateIssuerIdentityAction, [values], t('settings.account.business.saved'), t('settings.account.business.saveFailed'))
    setBusy(false)
  }

  return (
    <IssuerIdentityForm
      fields={localizeIssuerFields(fieldsByTier([1, 2]), t.locale)}
      initialValues={issuer}
      onSubmit={handleSubmit}
      submitLabel={t('settings.account.business.save')}
      busy={busy}
      translated
    />
  )
}
