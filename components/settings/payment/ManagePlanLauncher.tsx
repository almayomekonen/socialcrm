'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import ManagePlanModal from './ManagePlanModal'

/**
 * Serialized payload that crosses the server→client boundary.
 *
 * Dates are sent as ISO strings; the modal converts to Date only when needed
 * (via formatDate, which accepts strings). All other fields are primitive.
 */
export type SubscriptionClientView = {
  plan: 'free' | 'pro'
  expiresAtIso: string | null
  cancelAtPeriodEnd: boolean
  status: 'active' | 'cancelling' | 'inactive'
  manageable: boolean
}

/**
 * Owns the modal's open state and nothing else. Lives between the server
 * card (which has no state) and the client modal (which has its own
 * optimistic state). Keeping the launcher this thin avoids the temptation
 * to lift logic up here that should live in the modal.
 */
export default function ManagePlanLauncher({ subscription }: { subscription: SubscriptionClientView }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Btn variant='outline' lbl='נהל מסלול' onClick={() => setOpen(true)} />
      <ManagePlanModal open={open} onClose={() => setOpen(false)} subscription={subscription} />
    </>
  )
}
