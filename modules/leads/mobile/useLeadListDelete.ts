'use client'

import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { toast } from '@/lib/toast'
import { setAction, type SelectionState } from '@/components/mobile/selectionState'
import { deleteManyLeads } from '@/actions/clients'
import { deleteLeadsMessage } from '@/lib/leads/deleteResult'
import { removeSelectedLeads, restoreLeads, type LeadListCard } from './leadSelection'

/**
 * Optimistic batch delete for the phone list (extracted from
 * `LeadListMobileClient`, no behaviour change): the rows leave at once, the
 * existing `deleteManyLeads` runs, and blocked or failed leads come back still
 * selected so the rep sees exactly which ones stayed.
 */
export function useLeadListDelete({
  selected,
  itemsRef,
  setItems,
  setSel,
  exit,
  pendingRef,
}: {
  selected: ReadonlySet<number>
  itemsRef: MutableRefObject<LeadListCard[]>
  setItems: Dispatch<SetStateAction<LeadListCard[]>>
  setSel: Dispatch<SetStateAction<SelectionState>>
  exit: () => void
  pendingRef: MutableRefObject<number>
}) {
  const [busy, setBusy] = useState(false)

  const runDelete = async () => {
    const ids = new Set(selected)
    if (ids.size === 0) return
    const snapshot = itemsRef.current
    pendingRef.current += 1
    setBusy(true)
    setSel((prev) => setAction(prev, null))
    setItems(removeSelectedLeads(snapshot, ids))
    try {
      const result = await deleteManyLeads([...ids])
      const blocked = new Set(result.blockedLeads.map((b) => b.id))
      if (result.deletedCount === 0 && result.blockedCount === 0) {
        setItems((current) => restoreLeads(current, snapshot, ids))
        setSel({ ids, action: null })
        toast('error', 'לא נמחקו לידים')
      } else {
        const { icon, msg } = deleteLeadsMessage(result)
        toast(icon, msg)
        if (blocked.size > 0) {
          setItems((current) => restoreLeads(current, snapshot, blocked))
          setSel({ ids: blocked, action: null })
        } else {
          exit()
        }
      }
    } catch {
      setItems((current) => restoreLeads(current, snapshot, ids))
      setSel({ ids, action: null })
      toast('error', 'לא הצלחנו למחוק את הלידים')
    }
    pendingRef.current -= 1
    setBusy(false)
  }

  return { busy, runDelete }
}
