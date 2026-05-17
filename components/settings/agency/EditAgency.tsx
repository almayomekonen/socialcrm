'use client'

import { useState } from 'react'
import { api } from '@/lib/funcs'
import IssuerIdentityForm from '@/components/billing/issuer/IssuerIdentityForm'
import { fieldsByTier, type IssuerData } from '@/lib/billing/issuer/fields'
import { updateIssuerIdentityAction } from '@/actions/billing/issuer'


export default function EditAgency({ issuer }: { issuer: IssuerData }) {
  const [busy, setBusy] = useState(false)

  async function handleSubmit(values: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    await api(updateIssuerIdentityAction, [values], 'הפרטים נשמרו', 'שמירת הפרטים נכשלה')
    setBusy(false)
  }

  return (
    <IssuerIdentityForm
      fields={fieldsByTier([1, 2])}
      initialValues={issuer}
      onSubmit={handleSubmit}
      submitLabel='שמור פרטים'
      busy={busy}
    />
  )
}
