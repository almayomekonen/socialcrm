'use client'

import React, { useCallback, useRef, useState } from 'react'
import { updateLead } from '@/actions/clients'
import { api } from '@/lib/funcs'
import {
  isLatestStatusRequest,
  registerStatusRequest,
  resolveStatusChangeOutcome,
  STATUS_UPDATED_ANNOUNCE,
} from './leadStatusRequest'

type Args = {
  activeTab: string
  setActiveTab: React.Dispatch<React.SetStateAction<string>>
  setOptimisticStatuses: React.Dispatch<React.SetStateAction<Map<number, string>>>
}

/**
 * Lead status mutations: optimistic map + tab follow, quiet success (no loading/
 * success toast), error toast retained, tab rollback on failure, per-lead request
 * sequencing, and aria-live confirmation (Wave A5).
 */
export function useLeadActions({ activeTab, setActiveTab, setOptimisticStatuses }: Args) {
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const [statusAnnounce, setStatusAnnounce] = useState('')
  const latestRequestByLeadRef = useRef(new Map<number, number>())
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const handleStatusChange = useCallback(
    async (obj: { id: number; status: string }, newStatus: string) => {
      if (obj.status === newStatus) {
        return
      }

      const previousTab = activeTabRef.current
      const requestId = registerStatusRequest(latestRequestByLeadRef.current, obj.id)

      setActiveTab(newStatus)
      setOptimisticStatuses((prev) => {
        const next = new Map(prev)
        next.set(obj.id, newStatus)
        return next
      })
      setUpdatingId(obj.id)

      const res = await api(updateLead, { id: obj.id, status: newStatus }, STATUS_UPDATED_ANNOUNCE, undefined, {
        silentSuccess: true,
      })

      const outcome = resolveStatusChangeOutcome({
        isLatest: isLatestStatusRequest(latestRequestByLeadRef.current, obj.id, requestId),
        err: !!res?.err,
        previousTab,
      })

      if (!outcome.apply) {
        return
      }

      setUpdatingId(null)

      if (outcome.kind === 'rollback') {
        console.warn('[leads.status]', { leadId: obj.id, err: true })
        setActiveTab(outcome.previousTab)
        setOptimisticStatuses((prev) => {
          if (!prev.has(obj.id)) return prev
          const next = new Map(prev)
          next.delete(obj.id)
          return next
        })
        return
      }

      setHighlightedId(obj.id)
      setStatusAnnounce(STATUS_UPDATED_ANNOUNCE)
      setTimeout(() => {
        setHighlightedId((cur) => (cur === obj.id ? null : cur))
        setStatusAnnounce((cur) => (cur === STATUS_UPDATED_ANNOUNCE ? '' : cur))
      }, 2500)
    },
    [setActiveTab, setOptimisticStatuses],
  )

  return {
    updatingId,
    setUpdatingId,
    highlightedId,
    setHighlightedId,
    statusAnnounce,
    handleStatusChange,
  }
}
