'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { StatusBadge } from '@/lib/StatusBadge'
import { toast } from '@/lib/toast'
import { renameSource } from '@/actions/automations/connections'
import type { ConnectionView } from '@/lib/automations/connectors/overview'
import { HEALTH, SUBSCRIPTION, errorMessage } from './copy'

/**
 * One source, renameable in place.
 *
 * The provider's own label refreshes on every delivery, so a business's
 * wording is stored separately and overlaid on read — which is why renaming
 * needed no connector change and works for every integration at once.
 * Clearing the field restores the provider's name rather than blanking it.
 */
export default function SourceRow({
  connectionId,
  source,
  onChanged,
}: {
  connectionId: string
  source: ConnectionView['sources'][number]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(source.label)
  const [pending, start] = useTransition()
  const sub = SUBSCRIPTION[source.subscription]
  const srcHealth = HEALTH[source.health]

  function save() {
    start(async () => {
      const res = await renameSource(connectionId, source.id, label)
      if (!res.ok) return toast('error', errorMessage(res.reason ?? ''))
      setEditing(false)
      toast('success', 'השם עודכן')
      onChanged()
    })
  }

  if (editing) {
    return (
      <li className='grid gap-2'>
        <Input lbl='שם המקור' value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className='flex items-center gap-2'>
          <Btn size='small' lbl={pending ? 'שומר…' : 'שמור שם'} disabled={pending} onClick={save} />
          <Btn variant='ghost' size='small' lbl='ביטול' onClick={() => (setLabel(source.label), setEditing(false))} />
        </div>
        <p className='text-sm text-gray-500'>השארת השדה ריק תחזיר את השם המקורי.</p>
      </li>
    )
  }

  return (
    <li className='flex items-center justify-between gap-3'>
      {/* The local value, not the prop: a saved name shows immediately rather
          than reverting for the moment it takes the page to refresh. */}
      <span className='min-w-0 truncate text-sm text-gray-700'>{label}</span>
      <span className='flex shrink-0 items-center gap-2'>
        <StatusBadge role={sub.role} label={sub.label} size='xs' />
        {source.health !== 'ok' && <StatusBadge role={srcHealth.role} label={srcHealth.label} size='xs' />}
        <Btn variant='ghost' size='small' lbl='שינוי שם' icon='pen' onClick={() => setEditing(true)} />
      </span>
    </li>
  )
}
