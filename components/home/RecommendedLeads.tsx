'use client'

import { useEffect, useState } from 'react'

export type RecommendedItem = { lead: { id: number; name: string; phone: string | null }; reason: string }

// BISECT: RecommendedLeads disabled — hooks preserved, renders nothing.
export default function RecommendedLeads({ items }: { items: RecommendedItem[] }) {
  const [, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [items])
  return null
}
