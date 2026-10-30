'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { StatusBadge } from '@/lib/StatusBadge'
import { toast } from '@/lib/toast'
import { renameSource } from '@/actions/automations/connections'
import type { ConnectionView } from '@/lib/automations/connectors/overview'
import { errorMessageIn, healthIn, subscriptionIn } from './copy'
import { customerTextAttrs } from '@/lib/i18n/config'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
  const sub = subscriptionIn(source.subscription, t.locale)
  const srcHealth = healthIn(source.health, t.locale)

  function save() {
    start(async () => {
      const res = await renameSource(connectionId, source.id, label)
      if (!res.ok) return toast('error', errorMessageIn(res.reason ?? '', t.locale))
      setEditing(false)
      toast('success', t('admin.connections.source.renamed'))
      onChanged()
    })
  }

  if (editing) {
    return (
      <li className='grid gap-2'>
        <Input lbl={t('admin.connections.source.name')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className='flex items-center gap-2'>
          <Btn size='small' lbl={pending ? t('admin.connections.source.saving') : t('admin.connections.source.save')} disabled={pending} onClick={save} />
          <Btn variant='ghost' size='small' lbl={t('common.dialog.cancel')} onClick={() => (setLabel(source.label), setEditing(false))} />
        </div>
        <p className='text-sm text-gray-500'>{t('admin.connections.source.resetHint')}</p>
      </li>
    )
  }

  return (
    <li className='flex items-center justify-between gap-3'>
      {/* The local value, not the prop: a saved name shows immediately rather
          than reverting for the moment it takes the page to refresh. */}
      <span className='min-w-0 truncate text-sm text-gray-700' {...customerTextAttrs(t.locale)}>{label}</span>
      <span className='flex shrink-0 items-center gap-2'>
        <StatusBadge role={sub.role} label={sub.label} size='xs' />
        {source.health !== 'ok' && <StatusBadge role={srcHealth.role} label={srcHealth.label} size='xs' />}
        <Btn variant='ghost' size='small' lbl={t('admin.connections.source.rename')} icon='pen' onClick={() => setEditing(true)} />
      </span>
    </li>
  )
}
