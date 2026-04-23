'use client'

import React, { useEffect, useState } from 'react'
import { deleteManyLeads } from '@/actions/clients'
import { api } from '@/lib/funcs'
import { checkedIds } from '@/lib/table/funcs'

type Args = {
  leads: boolean
  tblId: string
  filteredData: any[]
  activeTab: string
  setLiveLeads: React.Dispatch<React.SetStateAction<any[]>>
  setDeletedIds: React.Dispatch<React.SetStateAction<Set<number>>>
}

export function useLeadSelection({ leads, tblId, filteredData, activeTab, setLiveLeads, setDeletedIds }: Args) {
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

    const successMsg = leads ? 'הלידים נמחקו' : 'הלקוחות נמחקו'
    const res = await api(deleteManyLeads, [selectedIds, leads], successMsg)
    if (res?.err) return

    const deleted: number = typeof res?.deleted === 'number' ? res.deleted : 0
    const skipped: number = typeof res?.skipped === 'number' ? res.skipped : 0

    const deletedSet = new Set<number>(deleted === selectedIds.length ? selectedIds : selectedIds.slice(0, deleted))

    if (deletedSet.size > 0) {
      setLiveLeads((prev) => prev.filter((c) => !deletedSet.has(Number(c.id))))
      setDeletedIds((prev) => {
        const next = new Set(prev)
        deletedSet.forEach((id) => next.add(id))
        return next
      })
    }

    clearDomChecks()

    if (skipped > 0) {
      setBulkInfoMsg(`${skipped} ללא הרשאה או לא נמצאו`)
    }
  }

  return {
    selectedIds,
    handleBulkDelete,
    clearDomChecks,
    bulkConfirmOpen,
    closeBulkConfirm: () => setBulkConfirmOpen(false),
    performBulkDelete,
    bulkInfoMsg,
    closeBulkInfo: () => setBulkInfoMsg(null),
  }
}
