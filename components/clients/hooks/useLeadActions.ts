'use client'

import React, { useState } from 'react'
import { updateLead } from '@/actions/clients'
import { api } from '@/lib/funcs'

type Args = {
  setActiveTab: React.Dispatch<React.SetStateAction<string>>
  setOptimisticStatuses: React.Dispatch<React.SetStateAction<Map<number, string>>>
}

export function useLeadActions({ setActiveTab, setOptimisticStatuses }: Args) {
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)

  async function handleStatusChange(obj: any, newStatus: string) {
    setActiveTab(newStatus)

    setOptimisticStatuses((prev) => {
      const next = new Map(prev)
      next.set(obj.id, newStatus)
      return next
    })
    setUpdatingId(obj.id)
    const res = await api(updateLead, { id: obj.id, status: newStatus }, 'סטטוס עודכן')
    setUpdatingId(null)
    if (!res || res?.err) {
      setOptimisticStatuses((prev) => {
        if (!prev.has(obj.id)) return prev
        const next = new Map(prev)
        next.delete(obj.id)
        return next
      })
      return
    }
    setHighlightedId(obj.id)
    setTimeout(() => setHighlightedId(null), 2500)
  }

  return { updatingId, setUpdatingId, highlightedId, setHighlightedId, handleStatusChange }
}
