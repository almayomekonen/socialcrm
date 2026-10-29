'use client'

import React, { useEffect, useState } from 'react'
import { assignLeadsToRep, deleteManyLeads } from '@/actions/clients'
import { api } from '@/lib/funcs'
import { checkedIds } from '@/lib/table/funcs'
import { toast } from '@/lib/toast'
import { deleteLeadsMessage } from '@/lib/leads/deleteResult'
import { useT } from '@/lib/i18n/I18nProvider'

type Args = {
  leads: boolean
  tblId: string
  filteredData: any[]
  activeTab: string
  setLiveLeads: React.Dispatch<React.SetStateAction<any[]>>
  setDeletedIds: React.Dispatch<React.SetStateAction<Set<number>>>
  setDeleting: React.Dispatch<React.SetStateAction<boolean>>
}

export function useLeadSelection({ leads, tblId, filteredData, activeTab, setLiveLeads, setDeletedIds, setDeleting }: Args) {
  const t = useT()
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  useEffect(() => {
    const el = document.getElementById(tblId)
    if (!el) return
    const sync = () => setSelectedIds(checkedIds(el))
    el.addEventListener('change', sync)
    sync()
    return () => el.removeEventListener('change', sync)
  }, [tblId, filteredData.length, activeTab])

  useEffect(() => {
    setSelectedIds((prev) => {
      const visibleIds = new Set(filteredData.map((r: any) => Number(r.id)))
      return prev.filter((id) => visibleIds.has(id))
    })
  }, [filteredData.length, activeTab])

  function clearDomChecks() {
    const all = document.getElementById('checkAll') as HTMLInputElement | null
    if (all) all.checked = false
    document.querySelectorAll<HTMLInputElement>("[name='checkRow']").forEach((cb) => (cb.checked = false))
    setSelectedIds([])
  }

  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkInfoMsg, setBulkInfoMsg] = useState<string | null>(null)

  function handleBulkDelete() {
    if (!selectedIds.length) return
    setBulkConfirmOpen(true)
  }

  async function performBulkDelete() {
    setBulkConfirmOpen(false)
    if (!selectedIds.length) return

    setDeleting(true)
    try {
      // silentSuccess: we compose the toast ourselves from the structured result
      // (success / partial / all-blocked), instead of api's generic success toast.
      const res = await api(deleteManyLeads, [selectedIds, leads], undefined, undefined, { silentSuccess: true })
      if (res?.err) return

      const blockedLeads = Array.isArray(res?.blockedLeads) ? res.blockedLeads : []
      const blockedIds = new Set<number>(blockedLeads.map((b: { id: number }) => Number(b.id)))
      // Everything selected that wasn't billing-blocked was deleted (the table is
      // permission-filtered, so selected ⊆ in-scope).
      const deletedSet = new Set<number>(selectedIds.filter((id) => !blockedIds.has(id)))

      if (deletedSet.size > 0) {
        setLiveLeads((prev) => prev.filter((c) => !deletedSet.has(Number(c.id))))
        setDeletedIds((prev) => {
          const next = new Set(prev)
          deletedSet.forEach((id) => next.add(id))
          return next
        })
      }

      clearDomChecks()

      const { icon, msg } = deleteLeadsMessage({
        deletedCount: typeof res?.deletedCount === 'number' ? res.deletedCount : deletedSet.size,
        blockedCount: typeof res?.blockedCount === 'number' ? res.blockedCount : blockedLeads.length,
        blockedLeads,
      }, t.locale)
      toast(icon, msg)
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Bulk assign — the selected-leads flow.
   *
   * Deliberately parallel to the delete trio above: the same `selectedIds`, the
   * same confirm-then-act shape, the same `clearDomChecks()` afterwards. The rows
   * are refreshed from the server rather than patched locally, because ownership
   * decides whether a lead is still visible to the current viewer at all.
   */
  const [assignOpen, setAssignOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)

  function handleBulkAssign() {
    if (!selectedIds.length) return
    setAssignOpen(true)
  }

  async function performBulkAssign(targetUserId: number) {
    setAssignOpen(false)
    if (!selectedIds.length || !targetUserId) return

    setAssigning(true)
    try {
      const res = await api(assignLeadsToRep, [selectedIds, targetUserId], undefined, undefined, { silentSuccess: true })
      if (res?.err) return

      const assigned = typeof res?.assignedCount === 'number' ? res.assignedCount : 0
      const skipped = typeof res?.skippedCount === 'number' ? res.skippedCount : 0

      clearDomChecks()
      if (assigned === 0) {
        toast('success', t('leads.assignResult.already'))
      } else if (skipped > 0) {
        toast('success', t('leads.assignResult.partial', { assigned: String(assigned), skipped: String(skipped) }))
      } else {
        toast('success', t('leads.assignResult.done', { count: String(assigned) }))
      }
    } finally {
      setAssigning(false)
    }
  }

  return {
    selectedIds,
    handleBulkDelete,
    clearDomChecks,
    handleBulkAssign,
    performBulkAssign,
    assignOpen,
    closeAssign: () => setAssignOpen(false),
    assigning,
    bulkConfirmOpen,
    closeBulkConfirm: () => setBulkConfirmOpen(false),
    performBulkDelete,
    bulkInfoMsg,
    closeBulkInfo: () => setBulkInfoMsg(null),
  }
}
