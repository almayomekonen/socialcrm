'use client'

import { useEffect, useRef, useState } from 'react'
import { useLeadPolling } from '@/lib/hooksNEvents'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'

type Args = {
  data: any
  leads: boolean
  activeTab: string
  globalLatestUpdatedAt: string
}

export function useLeadsState({ data, leads, activeTab, globalLatestUpdatedAt }: Args) {
  const t = useT()
  const safeData = Array.isArray(data) ? data : []
  const [liveLeads, setLiveLeads] = useState<any[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())
  const [optimisticStatuses, setOptimisticStatuses] = useState<Map<number, string>>(new Map())
  const [newLeadsCount, setNewLeadsCount] = useState(0)

  const dataRef = useRef<any[]>(safeData)
  useEffect(() => {
    dataRef.current = safeData
  }, [data])
  const optimisticStatusesRef = useRef(optimisticStatuses)
  useEffect(() => {
    optimisticStatusesRef.current = optimisticStatuses
  }, [optimisticStatuses])

  const liveIds = new Set(liveLeads.map((l) => l.id))
  const baseMerged = [...liveLeads, ...safeData.filter((d) => !liveIds.has(d.id) && !deletedIds.has(d.id))]
  const mergedState = optimisticStatuses.size
    ? baseMerged.map((row) => {
        const s = optimisticStatuses.get(row.id)
        if (s !== undefined && row.status !== s) {
          return { ...row, status: s }
        }
        return row
      })
    : baseMerged
  const filteredData = leads ? mergedState.filter((lead) => lead.status === activeTab) : mergedState

  useLeadPolling(
    (polledLeads) => {
      setLiveLeads((prev) => {
        const serverIds = new Set((Array.isArray(dataRef.current) ? dataRef.current : []).map((d) => d.id))
        const prevMap = new Map(prev.map((c) => [c.id, c]))
        const optimistic = optimisticStatusesRef.current

        let newCount = 0
        const next = [...prev]

        for (const lead of polledLeads) {
          if (optimistic.has(lead.id)) continue

          if (serverIds.has(lead.id)) {
            const idx = next.findIndex((r) => r.id === lead.id)
            if (idx >= 0) next.splice(idx, 1)
            continue
          }
          if (prevMap.has(lead.id)) {
            const idx = next.findIndex((r) => r.id === lead.id)
            const existing = next[idx]

            if (existing?.updatedAt && new Date(lead.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
              continue
            }
            next[idx] = lead
          } else {
            newCount++
            next.unshift(lead)
          }
        }

        if (newCount > 0) setNewLeadsCount(newCount)

        return next
      })
    },
    leads,
    globalLatestUpdatedAt,
  )

  useEffect(() => {
    if (newLeadsCount > 0) {
      toast('success', t('leads.dialog.newArrived', { count: String(newLeadsCount) }))
      setNewLeadsCount(0)
    }
  }, [newLeadsCount, t])

  useEffect(() => {
    const serverById = new Map<number, any>(safeData.map((d) => [d.id, d]))
    if (serverById.size > 0) {
      setLiveLeads((prev) => {
        const next = prev.filter((l) => !serverById.has(l.id))
        return next.length === prev.length ? prev : next
      })
    }
    setOptimisticStatuses((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Map(prev)
      for (const [id, status] of prev) {
        const row = serverById.get(id)
        if (row && row.status === status) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [data])

  return {
    liveLeads,
    setLiveLeads,
    deletedIds,
    setDeletedIds,
    optimisticStatuses,
    setOptimisticStatuses,
    newLeadsCount,
    setNewLeadsCount,
    mergedState,
    filteredData,
  }
}
