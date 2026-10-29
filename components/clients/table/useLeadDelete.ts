'use client'

import React, { useState } from 'react'
import { deleteLead } from '@/actions/clients'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { blockReasonText } from '@/lib/leads/deleteResult'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * What the rep is told when a single-lead delete is refused, keyed on the
 * server's `reason` code. A refusal without a known code falls back to the
 * server's own `msg` — Hebrew text from `actions/clients.ts`, shown as is.
 */
export function deleteLeadErrorMessage(res, locale: UiLocale = 'he'): string {
  const t = translatorFor(locale)
  const reason = res?.reason
  return reason === 'no_permission'
    ? t('leads.deleteError.noPermission')
    : reason === 'not_found'
    ? t('leads.deleteError.notFound')
    : reason === 'has_billing'
    ? t('leads.deleteError.hasBilling', {
        reason: res?.block ? blockReasonText(res.block, locale) : t('leads.deleteError.billingLinked'),
      })
    : res?.msg || t('leads.deleteError.generic')
}

/** The row menu's "מחיקה": confirm, delete, then drop the row or explain the refusal. */
export function useLeadDelete({
  setLiveLeads,
  setDeletedIds,
}: {
  setLiveLeads: React.Dispatch<React.SetStateAction<any[]>>
  setDeletedIds: React.Dispatch<React.SetStateAction<Set<number>>>
}) {
  const t = useT()
  const [confirmDeleteLead, setConfirmDeleteLead] = useState<any>(null)
  const [deleteErrMsg, setDeleteErrMsg] = useState<string | null>(null)

  async function performDelete() {
    const target = confirmDeleteLead
    if (!target) return
    const res = await api(deleteLead, target.id, undefined, undefined, { silentSuccess: true })
    if (res?.err || res?.error) {
      setDeleteErrMsg(deleteLeadErrorMessage(res, t.locale))
      setConfirmDeleteLead(null)
      return
    }
    toast('success', t('leads.dialog.deleted'))
    setLiveLeads((prev) => prev.filter((c) => c.id !== target.id))
    setDeletedIds((prev) => new Set([...prev, target.id]))
    setConfirmDeleteLead(null)
  }

  return {
    confirmDeleteLead,
    requestDelete: setConfirmDeleteLead,
    cancelDelete: () => setConfirmDeleteLead(null),
    performDelete,
    deleteErrMsg,
    clearDeleteErr: () => setDeleteErrMsg(null),
  }
}
