'use client'

import React from 'react'
import { Select } from '@/lib/form'

/**
 * Re-exported, not re-declared. The values moved to `lib/leads/statusStyles.ts`
 * — a framework-neutral module — because a Server Component importing them from
 * here received a client-reference proxy whose properties read as `undefined`,
 * and crashed on `style.bg`. Existing import paths are unchanged: everything
 * that imported these from this file still can.
 *
 * SERVER COMPONENTS SHOULD IMPORT FROM `lib/leads/statusStyles` DIRECTLY.
 */
export { STATUS_STYLES, STATUS_OPTIONS, statusStyle, type LeadStatusStyle } from '@/lib/leads/statusStyles'
import { STATUS_STYLES, STATUS_OPTIONS } from '@/lib/leads/statusStyles'

type Props = {
  status: string | null | undefined
  obj: any
  updatingId: number | null
  onStatusChange: (obj: any, newStatus: string) => void | Promise<void>
  leads?: boolean
}

const CLIENT_STATUS_OPTIONS = STATUS_OPTIONS.map((o) => (o.value === 'new' ? { ...o, label: 'לקוח' } : o))

function LeadStatusCell({ status, obj, updatingId, onStatusChange, leads = true }: Props) {
  const isUpdating = updatingId === obj.id
  const s = STATUS_STYLES[status ?? 'new'] || STATUS_STYLES.new
  const options = leads ? STATUS_OPTIONS : CLIENT_STATUS_OPTIONS
  return (
    <Select
      options={options}
      val='value'
      show='label'
      value={status ?? ''}
      required={false}
      className={`min-w-28 ${s.bg} ${s.text} ${s.border} ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}
      onChange={(e) => onStatusChange(obj, e.target.value)}
    />
  )
}

export default React.memo(LeadStatusCell)
