'use client'

import React, { useState } from 'react'
import { deleteLead } from '@/actions/clients'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { blockReasonText } from '@/lib/leads/deleteResult'

/** What the rep is told when a single-lead delete is refused, keyed on the server's `reason` code. */
export function deleteLeadErrorMessage(res): string {
  const reason = res?.reason
  return reason === 'no_permission'
    ? 'אין לך הרשאה למחוק ליד זה'
    : reason === 'not_found'
    ? 'הליד לא נמצא או כבר נמחק'
    : reason === 'has_billing'
    ? `לא ניתן למחוק — ${res?.block ? blockReasonText(res.block) : 'הליד מקושר למערכת החיובים'}`
    : res?.msg || 'שגיאה במחיקת הליד'
}

/** The row menu's "מחיקה": confirm, delete, then drop the row or explain the refusal. */
export function useLeadDelete({
  setLiveLeads,
  setDeletedIds,
}: {
  setLiveLeads: React.Dispatch<React.SetStateAction<any[]>>
  setDeletedIds: React.Dispatch<React.SetStateAction<Set<number>>>
}) {
  const [confirmDeleteLead, setConfirmDeleteLead] = useState<any>(null)
  const [deleteErrMsg, setDeleteErrMsg] = useState<string | null>(null)

  async function performDelete() {
    const target = confirmDeleteLead
    if (!target) return
    const res = await api(deleteLead, target.id, undefined, undefined, { silentSuccess: true })
    if (res?.err || res?.error) {
      setDeleteErrMsg(deleteLeadErrorMessage(res))
      setConfirmDeleteLead(null)
      return
    }
    toast('success', 'הליד נמחק')
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
